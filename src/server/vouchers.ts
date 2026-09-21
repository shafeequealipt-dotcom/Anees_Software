import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import {
  accounts,
  allocations,
  firms,
  items,
  ledgerCategories,
  moneyLedger,
  parties,
  partyLedger,
  stockLedger,
  taxRates,
  users,
  VOUCHER_TYPES,
  voucherSources,
  voucherLines,
  vouchers,
  type VoucherType,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { isIsoDate, todayIST } from "@/lib/dates";
import { calculateVoucher, supplyFor } from "@/lib/gst/engine";
import { buildPostings, PostingError } from "@/lib/posting";
import { formatMoney } from "@/lib/money";
import { setRegion } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { syncVoucherGl } from "./gl";
import { isZatcaIssued, ZATCA_LOCKED_MESSAGE } from "./zatca-lock";
import { syncServiceReminders } from "./notify/service";
import { SETTLES, VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";

export class VoucherError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

const isoDate = z.string().refine(isIsoDate, "Enter a valid date.");
const optDate = z.union([isoDate, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const optText = (max: number) =>
  z.string().max(max).nullish().transform((v) => (v && v.trim() ? v.trim() : null));
const int = z.number().int();
const nonNeg = z.number().int().min(0);

export const lineSchema = z.object({
  itemId: int.positive().nullish(),
  description: z.string().trim().min(1, "Each line needs an item or description.").max(300),
  hsn: optText(10),
  qtyMilli: int,
  unitCode: optText(10),
  unitFactorMilli: int.positive().default(1000),
  ratePaise: nonNeg,
  rateIncludesTax: z.boolean().default(false),
  discountBp: z.number().int().min(0).max(10000).default(0),
  discountPaise: nonNeg.default(0),
  taxRateId: int.positive().nullish(),
  gstBp: z.number().int().min(0).max(10000).default(0),
  cessBp: z.number().int().min(0).max(10000).default(0),
  mrpPaise: nonNeg.nullish(),
  batchNo: optText(60),
  mfgDate: optDate,
  expiryDate: optDate,
  serialNumbers: z.array(z.string().trim().min(1).max(60)).max(1000).nullish(),
  size: optText(40),
  modelNo: optText(60),
});

export const voucherSchema = z.object({
  id: int.positive().optional(),
  type: z.enum(VOUCHER_TYPES),
  number: int.positive().optional(),
  date: isoDate,
  dueDate: optDate,
  partyId: int.positive().nullish(),
  partyName: optText(200),
  partyPhone: optText(30),
  billingAddress: optText(1000),
  shippingAddress: optText(1000),
  placeOfSupply: z.string().regex(/^\d{2}$/).nullish(),
  reverseCharge: z.boolean().default(false),
  withoutTax: z.boolean().default(false),
  billDiscountBp: z.number().int().min(0).max(10000).default(0),
  billDiscountPaise: nonNeg.default(0),
  roundOff: z.boolean().default(true),
  amountPaise: nonNeg.default(0),
  paidPaise: nonNeg.default(0),
  accountId: int.positive().nullish(),
  toAccountId: int.positive().nullish(),
  paymentMode: optText(30),
  paymentRef: optText(100),
  direction: z.union([z.literal(1), z.literal(-1)]).nullish(),
  categoryId: int.positive().nullish(),
  sourceVoucherId: int.positive().nullish(),
  /** Expenses: is the tax on this bill claimable as input tax credit? */
  itcEligible: z.boolean().default(true),
  /** India: % tax collected at source (sales) and % tax deducted at source (sales, purchases, expenses). */
  tcsBp: z.number().int().min(0).max(10000).default(0),
  tdsBp: z.number().int().min(0).max(10000).default(0),
  /** Several orders/challans combined into this bill. */
  sourceVoucherIds: z.array(int.positive()).max(50).optional(),
  originalInvoiceNo: optText(60),
  originalInvoiceDate: optDate,
  supplierInvoiceNo: optText(60),
  poNumber: optText(60),
  poDate: optDate,
  ewayBillNo: optText(20),
  vehicleNo: optText(20),
  transportName: optText(120),
  notes: optText(2000),
  terms: optText(4000),
  lines: z.array(lineSchema).max(500).default([]),
  /** For payments: bills to settle. Omit to settle the oldest open bills automatically. */
  allocations: z.array(z.object({ toVoucherId: int.positive(), amountPaise: nonNeg })).optional(),
});

export type VoucherInput = z.input<typeof voucherSchema>;

export interface SaveResult {
  id: number;
  number: string;
  warnings: string[];
}

function zodMessage(e: z.ZodError): string {
  const first = e.issues[0];
  const where = first.path.length ? ` (${first.path.join(" › ")})` : "";
  return first.message + (first.message.endsWith(".") ? "" : ".") + (where.includes("lines") ? where : "");
}

export async function saveVoucher(
  db: DB,
  firmId: number,
  raw: VoucherInput,
  userId: number | null,
  ip?: string | null,
): Promise<SaveResult> {
  const parsed = voucherSchema.safeParse(raw);
  if (!parsed.success) throw new VoucherError(zodMessage(parsed.error));
  const input = parsed.data;
  const info = VOUCHER_INFO[input.type];

  return db.transaction(async (tx) => {
    const cfg = await getSettings(tx, firmId);
    const [firm] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
    if (!firm) throw new VoucherError("Set up your business details first (Settings › Business).");

    let existing: typeof vouchers.$inferSelect | undefined;
    if (input.id) {
      [existing] = await tx.select().from(vouchers).where(and(eq(vouchers.id, input.id), eq(vouchers.firmId, firmId))).for("update");
      if (!existing) throw new VoucherError("This entry no longer exists.");
      if (existing.status === "deleted") throw new VoucherError("This entry was deleted. Restore it first.");
      if (await isZatcaIssued(tx, existing.id)) throw new VoucherError(ZATCA_LOCKED_MESSAGE);
      if (existing.type !== input.type) throw new VoucherError("An entry can't change its type.");
      if (existing.status === "cancelled") throw new VoucherError("Cancelled entries can't be edited.");
    }

    // ── Party
    let party: typeof parties.$inferSelect | undefined;
    if (input.partyId) {
      [party] = await tx.select().from(parties).where(and(eq(parties.id, input.partyId), eq(parties.firmId, firmId)));
      if (!party) throw new VoucherError("The chosen party no longer exists.", "partyId");
    }
    if (["payment_in", "payment_out"].includes(input.type) && !party) {
      throw new VoucherError("Choose the party for this payment.", "partyId");
    }

    // ── Lines and tax
    const lineInputs = info.hasLines ? input.lines : [];
    if (info.hasLines && lineInputs.length === 0) throw new VoucherError("Add at least one item or line.");
    if (lineInputs.some((l) => l.qtyMilli <= 0 && input.type !== "expense" && input.type !== "other_income")) {
      throw new VoucherError("Quantity must be more than zero on every line.");
    }

    const itemIds = [...new Set(lineInputs.map((l) => l.itemId).filter((x): x is number => !!x))];
    const itemRows = itemIds.length ? await tx.select().from(items).where(and(inArray(items.id, itemIds), eq(items.firmId, firmId))) : [];
    const itemMap = new Map(itemRows.map((i) => [i.id, i]));
    for (const id of itemIds) if (!itemMap.has(id)) throw new VoucherError("An item on this bill no longer exists.");

    const taxIds = [...new Set(lineInputs.map((l) => l.taxRateId).filter((x): x is number => !!x))];
    const taxRows = taxIds.length ? await tx.select().from(taxRates).where(and(inArray(taxRates.id, taxIds), eq(taxRates.firmId, firmId))) : [];
    for (const id of taxIds) if (!taxRows.some((t) => t.id === id)) throw new VoucherError("A tax rate on this bill no longer exists.");
    const taxMap = new Map(taxRows.map((t) => [t.id, t]));

    const placeOfSupply = firm.country === "SA" ? null : input.placeOfSupply || party?.stateCode || firm.stateCode;
    const composition = firm.gstScheme !== "regular" && info.outward;
    const withoutTax =
      input.type === "stock_adjustment" || input.type === "delivery_challan" ? true : input.withoutTax || composition;

    const normalizedLines = lineInputs.map((l) => {
      const t = l.taxRateId ? taxMap.get(l.taxRateId) : undefined;
      return {
        ...l,
        gstBp: t ? t.gstBp : l.gstBp,
        cessBp: t ? t.cessBp : l.cessBp,
        qtyMilli: input.type === "expense" || input.type === "other_income" ? Math.max(l.qtyMilli, 1000) : l.qtyMilli,
      };
    });

    const calc = calculateVoucher({
      supply: supplyFor(firm.country, firm.stateCode, placeOfSupply),
      roundOff: info.hasLines && input.type !== "stock_adjustment" ? input.roundOff : false,
      withoutTax,
      billDiscountBp: input.billDiscountBp || undefined,
      billDiscountPaise: input.billDiscountBp ? undefined : input.billDiscountPaise,
      lines: normalizedLines.map((l) => ({
        qtyMilli: l.qtyMilli,
        ratePaise: l.ratePaise,
        rateIncludesTax: l.rateIncludesTax,
        discountBp: l.discountBp || undefined,
        discountPaise: l.discountBp ? undefined : l.discountPaise,
        gstBp: l.gstBp,
        cessBp: l.cessBp,
      })),
    });

    const taxTotal = calc.cgstPaise + calc.sgstPaise + calc.igstPaise + calc.cessPaise;
    const tcsBp = info.hasLines && firm.country === "IN" && input.type === "sale_invoice" ? input.tcsBp : 0;
    const tdsBp = info.hasLines && firm.country === "IN" && party && ["sale_invoice", "purchase_bill", "expense"].includes(input.type) ? input.tdsBp : 0;
    const tcsPaise = Math.round(((calc.taxablePaise + taxTotal) * tcsBp) / 10000);
    const tdsPaise = Math.round((calc.taxablePaise * tdsBp) / 10000);
    const totalPaise = info.hasLines ? calc.totalPaise + tcsPaise : input.amountPaise;
    if (!info.hasLines && totalPaise <= 0) throw new VoucherError("Enter an amount more than zero.", "amountPaise");
    if (info.hasLines && input.type !== "stock_adjustment" && totalPaise < 0) {
      throw new VoucherError("The bill total can't be negative.");
    }

    let paidPaise = 0;
    if (info.takesPayment) {
      paidPaise = Math.min(input.paidPaise, totalPaise - tdsPaise);
      if (!party) paidPaise = totalPaise; // walk-in / cash bill
    } else if (!info.hasLines) {
      paidPaise = totalPaise;
    }

    let accountId = input.accountId ?? null;
    if ((paidPaise > 0 || ["payment_in", "payment_out", "money_adjustment", "money_transfer"].includes(input.type)) && !accountId) {
      const [cash] = await tx.select().from(accounts).where(and(eq(accounts.firmId, firmId), eq(accounts.kind, "cash"), eq(accounts.active, true))).orderBy(desc(accounts.isDefault), asc(accounts.id)).limit(1);
      accountId = cash?.id ?? null;
    }
    const accountIds = [accountId, input.type === "money_transfer" ? input.toAccountId : null].filter((x): x is number => !!x);
    if (accountIds.length) {
      const own = await tx.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, accountIds), eq(accounts.firmId, firmId)));
      if (own.length !== new Set(accountIds).size) throw new VoucherError("Choose an account from this company.", "accountId");
    }
    if (input.categoryId) {
      const [cat] = await tx.select({ id: ledgerCategories.id }).from(ledgerCategories).where(and(eq(ledgerCategories.id, input.categoryId), eq(ledgerCategories.firmId, firmId)));
      if (!cat) throw new VoucherError("Choose a category from this company.", "categoryId");
    }
    const sourceIds = [...new Set(input.sourceVoucherIds?.length ? input.sourceVoucherIds : input.sourceVoucherId ? [input.sourceVoucherId] : [])];
    if (sourceIds.length) {
      const srcs = await tx.select({ id: vouchers.id, partyId: vouchers.partyId, status: vouchers.status }).from(vouchers).where(and(inArray(vouchers.id, sourceIds), eq(vouchers.firmId, firmId)));
      if (srcs.length !== sourceIds.length || srcs.some((s) => s.status === "deleted")) throw new VoucherError("The source document no longer exists.");
      if (party && srcs.some((s) => s.partyId && s.partyId !== party.id)) throw new VoucherError("All the documents combined into one bill must be for the same party.");
    }
    if (input.type === "money_transfer" && !input.toAccountId) throw new VoucherError("Choose the account to move money into.", "toAccountId");

    // ── Number
    const prefix = existing ? existing.prefix : (cfg.prefixes[input.type] ?? "");
    let number = input.number ?? existing?.number;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`voucher:${firm.id}:${input.type}:${prefix}`}))`);
    if (!number) {
      const [row] = await tx
        .select({ max: sql<number>`coalesce(max(${vouchers.number}), 0)::int` })
        .from(vouchers)
        .where(and(eq(vouchers.firmId, firm.id), eq(vouchers.type, input.type), eq(vouchers.prefix, prefix)));
      number = row.max + 1;
    } else {
      const clash = await tx
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.firmId, firm.id),
            eq(vouchers.type, input.type),
            eq(vouchers.prefix, prefix),
            eq(vouchers.number, number),
            existing ? ne(vouchers.id, existing.id) : sql`true`,
          ),
        );
      if (clash.length) throw new VoucherError(`Number ${prefix}${number} is already used.`, "number");
    }

    const dueDate =
      input.dueDate ??
      (party?.creditDays && ["sale_invoice", "purchase_bill"].includes(input.type)
        ? new Date(Date.parse(input.date + "T00:00:00Z") + party.creditDays * 86_400_000).toISOString().slice(0, 10)
        : null);

    const values = {
      firmId: firm.id,
      type: input.type,
      prefix,
      number,
      date: input.date,
      dueDate,
      status: "active" as const,
      partyId: party?.id ?? null,
      partyName: party?.name ?? input.partyName,
      partyGstin: party?.gstin ?? null,
      partyPhone: party?.phone ?? input.partyPhone,
      billingAddress: input.billingAddress ?? party?.billingAddress ?? null,
      shippingAddress: input.shippingAddress ?? party?.shippingAddress ?? null,
      placeOfSupply,
      reverseCharge: input.reverseCharge,
      withoutTax,
      grossPaise: calc.grossPaise,
      discountPaise: calc.discountPaise,
      billDiscountPaise: input.billDiscountBp ? 0 : input.billDiscountPaise,
      billDiscountBp: input.billDiscountBp,
      taxablePaise: info.hasLines ? calc.taxablePaise : totalPaise,
      cgstPaise: calc.cgstPaise,
      sgstPaise: calc.sgstPaise,
      igstPaise: calc.igstPaise,
      cessPaise: calc.cessPaise,
      roundOffPaise: calc.roundOffPaise,
      totalPaise,
      paidPaise,
      accountId,
      toAccountId: input.type === "money_transfer" ? (input.toAccountId ?? null) : null,
      paymentMode: input.paymentMode,
      paymentRef: input.paymentRef,
      direction: ["stock_adjustment", "money_adjustment"].includes(input.type) ? (input.direction ?? 1) : null,
      categoryId: input.categoryId ?? null,
      sourceVoucherId: sourceIds[0] ?? existing?.sourceVoucherId ?? null,
      itcEligible: input.itcEligible,
      tcsBp,
      tcsPaise,
      tdsBp,
      tdsPaise,
      originalInvoiceNo: input.originalInvoiceNo,
      originalInvoiceDate: input.originalInvoiceDate,
      supplierInvoiceNo: input.supplierInvoiceNo,
      poNumber: input.poNumber,
      poDate: input.poDate,
      ewayBillNo: input.ewayBillNo,
      vehicleNo: input.vehicleNo,
      transportName: input.transportName,
      notes: input.notes,
      terms: input.terms,
      updatedBy: userId,
      updatedAt: new Date(),
    };

    let id: number;
    if (existing) {
      await tx.update(vouchers).set(values).where(eq(vouchers.id, existing.id));
      id = existing.id;
      await tx.delete(voucherLines).where(eq(voucherLines.voucherId, id));
    } else {
      const [row] = await tx.insert(vouchers).values({ ...values, createdBy: userId }).returning({ id: vouchers.id });
      id = row.id;
    }

    if (sourceIds.length) {
      await tx.delete(voucherSources).where(eq(voucherSources.voucherId, id));
      await tx.insert(voucherSources).values(sourceIds.map((sourceId) => ({ voucherId: id, sourceId })));
    }

    // ── Lines
    const insertedLines = normalizedLines.length
      ? await tx
          .insert(voucherLines)
          .values(
            normalizedLines.map((l, i) => {
              const r = calc.lines[i];
              const item = l.itemId ? itemMap.get(l.itemId) : undefined;
              return {
                voucherId: id,
                lineNo: i + 1,
                itemId: l.itemId ?? null,
                description: l.description,
                hsn: l.hsn ?? item?.hsn ?? null,
                qtyMilli: l.qtyMilli,
                unitCode: l.unitCode,
                unitFactorMilli: l.unitFactorMilli,
                ratePaise: l.ratePaise,
                rateIncludesTax: l.rateIncludesTax,
                discountBp: l.discountBp,
                lineDiscountPaise: r.lineDiscountPaise,
                billDiscountPaise: r.billDiscountPaise,
                grossPaise: r.grossPaise,
                taxablePaise: r.taxablePaise,
                taxRateId: l.taxRateId ?? null,
                gstBp: r.gstBp,
                cessBp: r.cessBp,
                cgstPaise: r.cgstPaise,
                sgstPaise: r.sgstPaise,
                igstPaise: r.igstPaise,
                cessPaise: r.cessPaise,
                totalPaise: r.totalPaise,
                mrpPaise: l.mrpPaise ?? null,
                batchNo: l.batchNo,
                mfgDate: l.mfgDate,
                expiryDate: l.expiryDate,
                serialNumbers: l.serialNumbers?.length ? l.serialNumbers : null,
                size: l.size,
                modelNo: l.modelNo,
              };
            }),
          )
          .returning({ id: voucherLines.id, lineNo: voucherLines.lineNo })
      : [];

    // ── Ledgers
    await clearPostings(tx, id);
    let postings;
    try {
      postings = buildPostings({
        type: input.type,
        date: input.date,
        status: "active",
        partyId: party?.id ?? null,
        totalPaise,
        paidPaise,
        tdsPaise,
        accountId,
        toAccountId: values.toAccountId,
        direction: values.direction,
        lines: normalizedLines.map((l, i) => {
          const item = l.itemId ? itemMap.get(l.itemId) : undefined;
          // Stock value for sales is the item's cost, not the selling price.
          const costPerBase = item ? item.purchasePricePaise : 0;
          const baseQty = Math.round((l.qtyMilli * l.unitFactorMilli) / 1000);
          const valueAtCost = Math.round((baseQty * costPerBase) / 1000);
          const inward = ["purchase_bill", "credit_note"].includes(input.type) || (input.type === "stock_adjustment" && (values.direction ?? 1) > 0);
          return {
            lineId: insertedLines[i]?.id,
            itemId: l.itemId ?? null,
            isGoods: item?.kind === "goods",
            qtyMilli: l.qtyMilli,
            unitFactorMilli: l.unitFactorMilli,
            taxablePaise: input.type === "purchase_bill" || (input.type === "stock_adjustment" && inward && l.ratePaise > 0) ? calc.lines[i].taxablePaise : valueAtCost,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
          };
        }),
      });
    } catch (e) {
      if (e instanceof PostingError) throw new VoucherError(e.message);
      throw e;
    }
    await insertPostings(tx, id, postings);
    await syncVoucherGl(tx, firmId, id);
    await syncServiceReminders(tx, firmId, id);

    // ── Settlement against bills
    const warnings: string[] = [];
    if (SETTLES[input.type] && party) {
      await tx.delete(allocations).where(eq(allocations.fromVoucherId, id));
      const settleAmount =
        input.type === "payment_in" || input.type === "payment_out" ? totalPaise : input.type === "credit_note" || input.type === "debit_note" ? totalPaise - paidPaise : 0;
      if (settleAmount > 0) {
        await allocate(tx, id, party.id, SETTLES[input.type]!, settleAmount, input.allocations, input.sourceVoucherId ?? null);
      }
    }
    if (existing && info.takesPayment && party) {
      const allocated = await allocatedTo(tx, id);
      if (allocated + paidPaise > totalPaise - tdsPaise) {
        // Bill got smaller than what has already been paid against it: release the excess from the newest payments.
        await trimAllocations(tx, id, allocated + paidPaise - (totalPaise - tdsPaise));
        warnings.push("The bill total is now less than what was already paid against it. The extra payment is kept as an advance on the party.");
      }
    }

    // ── Stock warnings
    if (info.posts && ["sale_invoice", "debit_note"].includes(input.type) || (input.type === "stock_adjustment" && values.direction === -1)) {
      const goodsIds = itemIds.filter((iid) => itemMap.get(iid)?.kind === "goods");
      if (goodsIds.length) {
        const stock = await tx
          .select({ itemId: stockLedger.itemId, qty: sql<number>`sum(${stockLedger.qtyMilli})::bigint` })
          .from(stockLedger)
          .where(inArray(stockLedger.itemId, goodsIds))
          .groupBy(stockLedger.itemId);
        for (const s of stock) {
          const qty = Number(s.qty);
          if (qty < 0) {
            const item = itemMap.get(s.itemId)!;
            if (!cfg.allowNegativeStock) {
              throw new VoucherError(`Not enough stock of "${item.name}". Stock would go to ${qty / 1000}.`);
            }
            warnings.push(`Stock of "${item.name}" is now ${qty / 1000} (below zero).`);
          }
        }
      }
    }

    // ── Credit limit
    if (input.type === "sale_invoice" && party?.creditLimitPaise != null && cfg.creditLimitMode !== "off") {
      const [b] = await tx.select({ bal: sql<number>`coalesce(sum(${partyLedger.amountPaise}), 0)::bigint` }).from(partyLedger).where(eq(partyLedger.partyId, party.id));
      const owes = Number(b.bal);
      const worsens = !existing || totalPaise - tdsPaise - paidPaise > existing.totalPaise - existing.tdsPaise - existing.paidPaise;
      if (owes > party.creditLimitPaise && worsens) {
        setRegion(firm.country);
        const msg = `${party.name} now owes ${formatMoney(owes)}, above the credit limit of ${formatMoney(party.creditLimitPaise)}.`;
        if (cfg.creditLimitMode === "block") throw new VoucherError(`${msg} Change the bill, or raise the limit on the party.`, "partyId");
        warnings.push(msg);
      }
    }

    await audit(tx, {
      firmId,
      userId,
      action: existing ? "update" : "create",
      entity: "voucher",
      entityId: id,
      summary: `${existing ? "Edited" : "Created"} ${info.label.toLowerCase()} ${prefix}${number}${values.partyName ? ` for ${values.partyName}` : ""} — total ${(totalPaise / 100).toFixed(2)}`,
      before: existing ?? undefined,
      after: { ...values, lines: normalizedLines.length },
      ip,
    });

    return { id, number: voucherNumber({ prefix, number }), warnings };
  });
}

async function clearPostings(tx: Tx, voucherId: number) {
  await tx.delete(partyLedger).where(eq(partyLedger.voucherId, voucherId));
  await tx.delete(moneyLedger).where(eq(moneyLedger.voucherId, voucherId));
  await tx.delete(stockLedger).where(eq(stockLedger.voucherId, voucherId));
}

async function insertPostings(tx: Tx, voucherId: number, p: ReturnType<typeof buildPostings>) {
  if (p.party.length) {
    await tx.insert(partyLedger).values(p.party.map((e) => ({ ...e, memo: e.memo ?? null, source: "voucher" as const, voucherId })));
  }
  if (p.money.length) {
    await tx.insert(moneyLedger).values(p.money.map((e) => ({ ...e, memo: e.memo ?? null, source: "voucher" as const, voucherId })));
  }
  if (p.stock.length) {
    await tx.insert(stockLedger).values(
      p.stock.map((e) => ({
        source: "voucher" as const,
        voucherId,
        lineId: e.lineId ?? null,
        itemId: e.itemId,
        date: e.date,
        qtyMilli: e.qtyMilli,
        valuePaise: e.valuePaise,
        batchNo: e.batchNo ?? null,
        expiryDate: e.expiryDate ?? null,
      })),
    );
  }
}

async function allocatedTo(tx: Tx, billId: number): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<number>`coalesce(sum(${allocations.amountPaise}), 0)::bigint` })
    .from(allocations)
    .where(eq(allocations.toVoucherId, billId));
  return Number(row.sum);
}

async function trimAllocations(tx: Tx, billId: number, excess: number) {
  const rows = await tx.select().from(allocations).where(eq(allocations.toVoucherId, billId)).orderBy(desc(allocations.id));
  for (const a of rows) {
    if (excess <= 0) break;
    const cut = Math.min(a.amountPaise, excess);
    if (cut === a.amountPaise) await tx.delete(allocations).where(eq(allocations.id, a.id));
    else await tx.update(allocations).set({ amountPaise: a.amountPaise - cut }).where(eq(allocations.id, a.id));
    excess -= cut;
  }
}

/** Open (unpaid) balance of bills of the given types for a party, oldest first. */
export async function openBills(db: DB | Tx, partyId: number, types: VoucherType[], excludeFromVoucherId?: number) {
  const rows = await db
    .select({
      id: vouchers.id,
      type: vouchers.type,
      prefix: vouchers.prefix,
      number: vouchers.number,
      date: vouchers.date,
      dueDate: vouchers.dueDate,
      totalPaise: vouchers.totalPaise,
      paidPaise: vouchers.paidPaise,
      tdsPaise: vouchers.tdsPaise,
      allocated: sql<number>`coalesce((select sum(a.amount_paise) from allocations a where a.to_voucher_id = "vouchers"."id" ${
        excludeFromVoucherId ? sql`and a.from_voucher_id <> ${excludeFromVoucherId}` : sql``
      }), 0)::bigint`,
    })
    .from(vouchers)
    .where(and(eq(vouchers.partyId, partyId), inArray(vouchers.type, types), eq(vouchers.status, "active")))
    .orderBy(asc(vouchers.date), asc(vouchers.id));
  return rows
    .map((r) => ({ ...r, balancePaise: r.totalPaise - r.tdsPaise - r.paidPaise - Number(r.allocated) }))
    .filter((r) => r.balancePaise > 0);
}

async function allocate(
  tx: Tx,
  fromId: number,
  partyId: number,
  types: VoucherType[],
  amount: number,
  requested: { toVoucherId: number; amountPaise: number }[] | undefined,
  sourceVoucherId: number | null,
) {
  const open = await openBills(tx, partyId, types, fromId);
  const byId = new Map(open.map((b) => [b.id, b]));
  const rows: { fromVoucherId: number; toVoucherId: number; amountPaise: number }[] = [];
  let left = amount;

  const take = (billId: number, want: number) => {
    const bill = byId.get(billId);
    if (!bill || left <= 0) return;
    const amt = Math.min(want, bill.balancePaise, left);
    if (amt <= 0) return;
    rows.push({ fromVoucherId: fromId, toVoucherId: billId, amountPaise: amt });
    bill.balancePaise -= amt;
    left -= amt;
  };

  if (requested) {
    for (const r of requested) {
      if (!byId.has(r.toVoucherId)) throw new VoucherError("One of the selected bills is already fully paid or doesn't belong to this party.");
      take(r.toVoucherId, r.amountPaise);
    }
  } else {
    if (sourceVoucherId) take(sourceVoucherId, left);
    for (const b of open) take(b.id, left);
  }
  if (rows.length) await tx.insert(allocations).values(rows);
}

export async function cancelVoucher(db: DB, firmId: number, id: number, userId: number | null, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.id, id), eq(vouchers.firmId, firmId))).for("update");
    if (!v || v.status === "deleted") throw new VoucherError("This entry no longer exists.");
    if (v.status === "cancelled") return;
    if (await isZatcaIssued(tx, id)) throw new VoucherError(ZATCA_LOCKED_MESSAGE);
    await tx.update(vouchers).set({ status: "cancelled", updatedBy: userId, updatedAt: new Date() }).where(eq(vouchers.id, id));
    await clearPostings(tx, id);
    await tx.delete(allocations).where(sql`${allocations.fromVoucherId} = ${id} or ${allocations.toVoucherId} = ${id}`);
    await syncVoucherGl(tx, firmId, id);
    await syncServiceReminders(tx, firmId, id);
    await audit(tx, {
      userId,
      firmId,
      action: "cancel",
      entity: "voucher",
      entityId: id,
      summary: `Cancelled ${VOUCHER_INFO[v.type].label.toLowerCase()} ${voucherNumber(v)}${v.partyName ? ` for ${v.partyName}` : ""}`,
      before: v,
      ip,
    });
  });
}

interface DeletedSnapshot {
  fromStatus: "active" | "cancelled";
  party: Omit<typeof partyLedger.$inferSelect, "id">[];
  money: Omit<typeof moneyLedger.$inferSelect, "id">[];
  stock: Omit<typeof stockLedger.$inferSelect, "id">[];
  allocations: { fromVoucherId: number; toVoucherId: number; amountPaise: number }[];
}

const without = <T extends { id: number }>(rows: T[]): Omit<T, "id">[] => rows.map(({ id: _id, ...rest }) => rest);

/** Hides the bill and takes it out of every balance, but keeps everything needed to bring it back exactly (see restoreVoucher). */
export async function deleteVoucher(db: DB, firmId: number, id: number, userId: number | null, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.id, id), eq(vouchers.firmId, firmId))).for("update");
    if (!v || v.status === "deleted") return;
    if (await isZatcaIssued(tx, id)) throw new VoucherError(ZATCA_LOCKED_MESSAGE);
    const snapshot: DeletedSnapshot = {
      fromStatus: v.status,
      party: without(await tx.select().from(partyLedger).where(eq(partyLedger.voucherId, id))),
      money: without(await tx.select().from(moneyLedger).where(eq(moneyLedger.voucherId, id))),
      stock: without(await tx.select().from(stockLedger).where(eq(stockLedger.voucherId, id))),
      allocations: (await tx.select().from(allocations).where(sql`${allocations.fromVoucherId} = ${id} or ${allocations.toVoucherId} = ${id}`)).map(({ fromVoucherId, toVoucherId, amountPaise }) => ({ fromVoucherId, toVoucherId, amountPaise })),
    };
    await clearPostings(tx, id);
    await tx.delete(allocations).where(sql`${allocations.fromVoucherId} = ${id} or ${allocations.toVoucherId} = ${id}`);
    await tx.update(vouchers).set({ status: "deleted", deletedAt: new Date(), deletedBy: userId, deletedSnapshot: snapshot, updatedBy: userId, updatedAt: new Date() }).where(eq(vouchers.id, id));
    await syncVoucherGl(tx, firmId, id);
    await syncServiceReminders(tx, firmId, id);
    await audit(tx, {
      firmId,
      userId,
      action: "delete",
      entity: "voucher",
      entityId: id,
      summary: `Deleted ${VOUCHER_INFO[v.type].label.toLowerCase()} ${voucherNumber(v)}${v.partyName ? ` for ${v.partyName}` : ""} — total ${(v.totalPaise / 100).toFixed(2)}`,
      before: { type: v.type, number: voucherNumber(v), totalPaise: v.totalPaise, status: v.status },
      ip,
    });
  });
}

/** Brings a deleted bill back exactly as it was: same number, same ledger entries, same payments where they still fit. */
export async function restoreVoucher(db: DB, firmId: number, id: number, userId: number | null, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.id, id), eq(vouchers.firmId, firmId))).for("update");
    if (!v || v.status !== "deleted") throw new VoucherError("This entry isn't in the deleted list.");
    const snap = v.deletedSnapshot as DeletedSnapshot | null;
    if (!snap) throw new VoucherError("This entry has no saved snapshot, so it can't be restored.");

    if (v.partyId) {
      const [p] = await tx.select({ id: parties.id }).from(parties).where(and(eq(parties.id, v.partyId), eq(parties.firmId, firmId)));
      if (!p) throw new VoucherError("The party on this entry no longer exists.");
    }
    if (snap.party.length) await tx.insert(partyLedger).values(snap.party);
    if (snap.money.length) await tx.insert(moneyLedger).values(snap.money);
    if (snap.stock.length) await tx.insert(stockLedger).values(snap.stock);

    let reattached = 0;
    for (const a of snap.allocations) {
      const [from] = await tx.select({ total: sql<number>`${vouchers.totalPaise} - ${vouchers.tdsPaise}`.mapWith(Number), paid: vouchers.paidPaise, status: vouchers.status }).from(vouchers).where(eq(vouchers.id, a.fromVoucherId));
      const [to] = await tx.select({ total: sql<number>`${vouchers.totalPaise} - ${vouchers.tdsPaise}`.mapWith(Number), paid: vouchers.paidPaise, status: vouchers.status }).from(vouchers).where(eq(vouchers.id, a.toVoucherId));
      const usable = (vid: number, row?: { status: string }) => vid === id || row?.status === "active";
      if (!usable(a.fromVoucherId, from) || !usable(a.toVoucherId, to)) continue;
      const [fromUsed] = await tx.select({ n: sql<number>`coalesce(sum(${allocations.amountPaise}), 0)::bigint` }).from(allocations).where(eq(allocations.fromVoucherId, a.fromVoucherId));
      const toUsed = await allocatedTo(tx, a.toVoucherId);
      const fromLeft = (from?.total ?? v.totalPaise - v.tdsPaise) - Number(fromUsed.n);
      const toLeft = (to?.total ?? v.totalPaise - v.tdsPaise) - (to?.paid ?? v.paidPaise) - toUsed;
      const amount = Math.min(a.amountPaise, fromLeft, toLeft);
      if (amount > 0) {
        await tx.insert(allocations).values({ fromVoucherId: a.fromVoucherId, toVoucherId: a.toVoucherId, amountPaise: amount });
        reattached++;
      }
    }

    await tx.update(vouchers).set({ status: snap.fromStatus, deletedAt: null, deletedBy: null, deletedSnapshot: null, updatedBy: userId, updatedAt: new Date() }).where(eq(vouchers.id, id));
    await syncVoucherGl(tx, firmId, id);
    await syncServiceReminders(tx, firmId, id);
    await audit(tx, {
      firmId,
      userId,
      action: "restore",
      entity: "voucher",
      entityId: id,
      summary: `Restored ${VOUCHER_INFO[v.type].label.toLowerCase()} ${voucherNumber(v)}${v.partyName ? ` for ${v.partyName}` : ""}${snap.allocations.length && reattached < snap.allocations.length ? " (some payment links could not be re-attached)" : ""}`,
      ip,
    });
    return { number: voucherNumber(v), type: v.type };
  });
}

export async function listDeletedVouchers(db: DB, firmId: number) {
  return db
    .select({
      id: vouchers.id,
      type: vouchers.type,
      prefix: vouchers.prefix,
      number: vouchers.number,
      date: vouchers.date,
      partyName: vouchers.partyName,
      totalPaise: vouchers.totalPaise,
      deletedAt: vouchers.deletedAt,
      deletedBy: users.name,
    })
    .from(vouchers)
    .leftJoin(users, eq(users.id, vouchers.deletedBy))
    .where(and(eq(vouchers.firmId, firmId), eq(vouchers.status, "deleted")))
    .orderBy(desc(vouchers.deletedAt));
}

export async function getVoucher(db: DB | Tx, firmId: number, id: number) {
  const [v] = await db.select().from(vouchers).where(and(eq(vouchers.id, id), eq(vouchers.firmId, firmId), ne(vouchers.status, "deleted")));
  if (!v) return null;
  const lines = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, id)).orderBy(asc(voucherLines.lineNo));
  const settledBy = await db
    .select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date, amountPaise: allocations.amountPaise })
    .from(allocations)
    .innerJoin(vouchers, eq(vouchers.id, allocations.fromVoucherId))
    .where(eq(allocations.toVoucherId, id));
  const settles = await db
    .select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date, amountPaise: allocations.amountPaise })
    .from(allocations)
    .innerJoin(vouchers, eq(vouchers.id, allocations.toVoucherId))
    .where(eq(allocations.fromVoucherId, id));
  const pick = { id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date };
  const convertedRows = await db.select(pick).from(vouchers).where(and(eq(vouchers.sourceVoucherId, id), eq(vouchers.status, "active")));
  const viaLinks = await db.select(pick).from(voucherSources).innerJoin(vouchers, eq(vouchers.id, voucherSources.voucherId)).where(and(eq(voucherSources.sourceId, id), eq(vouchers.status, "active")));
  const converted = [...new Map([...convertedRows, ...viaLinks].map((c) => [c.id, c])).values()];
  const sourceRows = await db.select(pick).from(voucherSources).innerJoin(vouchers, eq(vouchers.id, voucherSources.sourceId)).where(eq(voucherSources.voucherId, id));
  const source = sourceRows[0] ?? (v.sourceVoucherId ? (await db.select(pick).from(vouchers).where(eq(vouchers.id, v.sourceVoucherId)))[0] ?? null : null);
  const sources = sourceRows.length ? sourceRows : source ? [source] : [];
  const settledPaise = settledBy.reduce((s, a) => s + a.amountPaise, 0);
  const balancePaise = VOUCHER_INFO[v.type].takesPayment && v.partyId ? v.totalPaise - v.tdsPaise - v.paidPaise - settledPaise : 0;
  return { voucher: v, lines, settledBy, settles, converted, source, sources, balancePaise };
}

export function paymentStatus(v: { totalPaise: number; dueDate: string | null; status: string }, balancePaise: number) {
  if (v.status === "cancelled") return "cancelled" as const;
  if (balancePaise <= 0) return "paid" as const;
  if (v.dueDate && v.dueDate < todayIST()) return "overdue" as const;
  if (balancePaise < v.totalPaise) return "partial" as const;
  return "unpaid" as const;
}

/** Open orders, quotations and challans that can still be turned into a bill, grouped by party. */
export async function listCombinable(db: DB, firmId: number, target: "sale_invoice" | "purchase_bill") {
  const types: VoucherType[] = target === "sale_invoice" ? ["quotation", "sales_order", "delivery_challan"] : ["purchase_order"];
  const list = await db
    .select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date, partyId: vouchers.partyId, partyName: vouchers.partyName, totalPaise: vouchers.totalPaise })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.firmId, firmId),
        inArray(vouchers.type, types),
        eq(vouchers.status, "active"),
        sql`${vouchers.partyId} is not null`,
        sql`not exists (select 1 from vouchers x where x.source_voucher_id = ${vouchers.id} and x.status = 'active')`,
        sql`not exists (select 1 from voucher_sources vs join vouchers x on x.id = vs.voucher_id where vs.source_id = ${vouchers.id} and x.status = 'active')`,
      ),
    )
    .orderBy(asc(vouchers.date), asc(vouchers.id));
  const byParty = new Map<number, { partyId: number; partyName: string; docs: typeof list }>();
  for (const d of list) {
    const g = byParty.get(d.partyId!) ?? { partyId: d.partyId!, partyName: d.partyName ?? "", docs: [] };
    g.docs.push(d);
    byParty.set(d.partyId!, g);
  }
  return [...byParty.values()].sort((a, b) => a.partyName.localeCompare(b.partyName));
}
