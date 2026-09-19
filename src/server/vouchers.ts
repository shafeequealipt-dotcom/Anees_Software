import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import {
  accounts,
  allocations,
  firms,
  items,
  moneyLedger,
  parties,
  partyLedger,
  stockLedger,
  taxRates,
  VOUCHER_TYPES,
  voucherLines,
  vouchers,
  type VoucherType,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { isIsoDate, todayIST } from "@/lib/dates";
import { calculateVoucher, supplyFor } from "@/lib/gst/engine";
import { buildPostings, PostingError } from "@/lib/posting";
import { getSettings } from "@/lib/settings";
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
  raw: VoucherInput,
  userId: number | null,
  ip?: string | null,
): Promise<SaveResult> {
  const parsed = voucherSchema.safeParse(raw);
  if (!parsed.success) throw new VoucherError(zodMessage(parsed.error));
  const input = parsed.data;
  const info = VOUCHER_INFO[input.type];

  return db.transaction(async (tx) => {
    const cfg = await getSettings(tx);
    const [firm] = await tx.select().from(firms).where(eq(firms.isDefault, true)).limit(1);
    if (!firm) throw new VoucherError("Set up your business details first (Settings › Business).");

    let existing: typeof vouchers.$inferSelect | undefined;
    if (input.id) {
      [existing] = await tx.select().from(vouchers).where(eq(vouchers.id, input.id)).for("update");
      if (!existing) throw new VoucherError("This entry no longer exists.");
      if (existing.type !== input.type) throw new VoucherError("An entry can't change its type.");
      if (existing.status === "cancelled") throw new VoucherError("Cancelled entries can't be edited.");
    }

    // ── Party
    let party: typeof parties.$inferSelect | undefined;
    if (input.partyId) {
      [party] = await tx.select().from(parties).where(eq(parties.id, input.partyId));
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
    const itemRows = itemIds.length ? await tx.select().from(items).where(inArray(items.id, itemIds)) : [];
    const itemMap = new Map(itemRows.map((i) => [i.id, i]));
    for (const id of itemIds) if (!itemMap.has(id)) throw new VoucherError("An item on this bill no longer exists.");

    const taxIds = [...new Set(lineInputs.map((l) => l.taxRateId).filter((x): x is number => !!x))];
    const taxRows = taxIds.length ? await tx.select().from(taxRates).where(inArray(taxRates.id, taxIds)) : [];
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

    const totalPaise = info.hasLines ? calc.totalPaise : input.amountPaise;
    if (!info.hasLines && totalPaise <= 0) throw new VoucherError("Enter an amount more than zero.", "amountPaise");
    if (info.hasLines && input.type !== "stock_adjustment" && totalPaise < 0) {
      throw new VoucherError("The bill total can't be negative.");
    }

    let paidPaise = 0;
    if (info.takesPayment) {
      paidPaise = Math.min(input.paidPaise, totalPaise);
      if (!party) paidPaise = totalPaise; // walk-in / cash bill
    } else if (!info.hasLines) {
      paidPaise = totalPaise;
    }

    let accountId = input.accountId ?? null;
    if ((paidPaise > 0 || ["payment_in", "payment_out", "money_adjustment", "money_transfer"].includes(input.type)) && !accountId) {
      const [cash] = await tx.select().from(accounts).where(and(eq(accounts.kind, "cash"), eq(accounts.active, true))).orderBy(desc(accounts.isDefault), asc(accounts.id)).limit(1);
      accountId = cash?.id ?? null;
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
      sourceVoucherId: input.sourceVoucherId ?? existing?.sourceVoucherId ?? null,
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
      if (allocated + paidPaise > totalPaise) {
        // Bill got smaller than what has already been paid against it: release the excess from the newest payments.
        await trimAllocations(tx, id, allocated + paidPaise - totalPaise);
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

    await audit(tx, {
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
      allocated: sql<number>`coalesce((select sum(a.amount_paise) from allocations a where a.to_voucher_id = ${vouchers.id} ${
        excludeFromVoucherId ? sql`and a.from_voucher_id <> ${excludeFromVoucherId}` : sql``
      }), 0)::bigint`,
    })
    .from(vouchers)
    .where(and(eq(vouchers.partyId, partyId), inArray(vouchers.type, types), eq(vouchers.status, "active")))
    .orderBy(asc(vouchers.date), asc(vouchers.id));
  return rows
    .map((r) => ({ ...r, balancePaise: r.totalPaise - r.paidPaise - Number(r.allocated) }))
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

export async function cancelVoucher(db: DB, id: number, userId: number | null, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(eq(vouchers.id, id)).for("update");
    if (!v) throw new VoucherError("This entry no longer exists.");
    if (v.status === "cancelled") return;
    await tx.update(vouchers).set({ status: "cancelled", updatedBy: userId, updatedAt: new Date() }).where(eq(vouchers.id, id));
    await clearPostings(tx, id);
    await tx.delete(allocations).where(sql`${allocations.fromVoucherId} = ${id} or ${allocations.toVoucherId} = ${id}`);
    await audit(tx, {
      userId,
      action: "cancel",
      entity: "voucher",
      entityId: id,
      summary: `Cancelled ${VOUCHER_INFO[v.type].label.toLowerCase()} ${voucherNumber(v)}${v.partyName ? ` for ${v.partyName}` : ""}`,
      before: v,
      ip,
    });
  });
}

export async function deleteVoucher(db: DB, id: number, userId: number | null, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(eq(vouchers.id, id)).for("update");
    if (!v) return;
    const lines = await tx.select().from(voucherLines).where(eq(voucherLines.voucherId, id));
    await tx.update(vouchers).set({ sourceVoucherId: null }).where(eq(vouchers.sourceVoucherId, id));
    await tx.delete(vouchers).where(eq(vouchers.id, id));
    await audit(tx, {
      userId,
      action: "delete",
      entity: "voucher",
      entityId: id,
      summary: `Deleted ${VOUCHER_INFO[v.type].label.toLowerCase()} ${voucherNumber(v)}${v.partyName ? ` for ${v.partyName}` : ""} — total ${(v.totalPaise / 100).toFixed(2)}`,
      before: { ...v, lines },
      ip,
    });
  });
}

export async function getVoucher(db: DB | Tx, id: number) {
  const [v] = await db.select().from(vouchers).where(eq(vouchers.id, id));
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
  const converted = await db
    .select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date })
    .from(vouchers)
    .where(and(eq(vouchers.sourceVoucherId, id), eq(vouchers.status, "active")));
  const source = v.sourceVoucherId
    ? (await db.select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date }).from(vouchers).where(eq(vouchers.id, v.sourceVoucherId)))[0] ?? null
    : null;
  const settledPaise = settledBy.reduce((s, a) => s + a.amountPaise, 0);
  const balancePaise = VOUCHER_INFO[v.type].takesPayment && v.partyId ? v.totalPaise - v.paidPaise - settledPaise : 0;
  return { voucher: v, lines, settledBy, settles, converted, source, balancePaise };
}

export function paymentStatus(v: { totalPaise: number; dueDate: string | null; status: string }, balancePaise: number) {
  if (v.status === "cancelled") return "cancelled" as const;
  if (balancePaise <= 0) return "paid" as const;
  if (v.dueDate && v.dueDate < todayIST()) return "overdue" as const;
  if (balancePaise < v.totalPaise) return "partial" as const;
  return "unpaid" as const;
}
