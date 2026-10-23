import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import {
  accounts,
  allocations,
  employees,
  partners,
  firms,
  items,
  ledgerCategories,
  locations,
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
import { baseQty, buildPostings, needsLocation, PostingError } from "@/lib/posting";
import { formatMoney, formatQty } from "@/lib/money";
import { setRegion } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { syncVoucherGl } from "./gl";
import { defaultLocationId, systemLocationId } from "./locations";
import { isZatcaIssued, ZATCA_LOCKED_MESSAGE } from "./zatca-lock";
import { syncServiceReminders } from "./notify/service";
import { SETTLES, VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import { productLabel } from "@/lib/product-id";

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
  /**
   * Stock transfers: sale prices typed on the transfer (per BASE unit), saved to the items in the same step so the new
   * price shows everywhere. Only filled in by the action for people who may edit items.
   */
  itemSalePrices: z.array(z.object({ itemId: int.positive(), salePricePaise: nonNeg })).max(500).optional(),
  /** Purchase bills: the supplier's printed total, honoured by the round-off when within ₹1 (see calculateVoucher). */
  matchTotalPaise: nonNeg.nullish(),
  amountPaise: nonNeg.default(0),
  paidPaise: nonNeg.default(0),
  accountId: int.positive().nullish(),
  toAccountId: int.positive().nullish(),
  /** Shop/warehouse this bill is from, or the source of a stock transfer. */
  locationId: int.positive().nullish(),
  /** Stock transfers only: the destination location. */
  toLocationId: int.positive().nullish(),
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
  /** Sale/purchase returns: why the goods came back. */
  returnReason: z.enum(["damaged", "wrong_item", "changed_mind", "quality", "other", "expired", "excess"]).nullish(),
  supplierInvoiceNo: optText(60),
  poNumber: optText(60),
  poDate: optDate,
  ewayBillNo: optText(20),
  vehicleNo: optText(20),
  transportName: optText(120),
  notes: optText(2000),
  terms: optText(4000),
  lines: z.array(lineSchema).max(500).default([]),
  /** Salary expenses only (set by the Staff screens): who was paid, for which month, advance or salary. */
  employeeId: int.positive().nullish(),
  payMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullish(),
  payKind: z.enum(["advance", "salary"]).nullish(),
  /** Partner payments only (set by the Partners screens): who was paid, for the month in payMonth. */
  partnerId: int.positive().nullish(),
  /** API only: the caller's key for the source line (unique per company), so nothing is entered twice. */
  externalRef: optText(120),
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
      if (existing.type === "stock_transfer" && existing.receivedAt) {
        throw new VoucherError("This transfer has already been received and can't be edited. Cancel it and make a new one if something needs fixing.");
      }
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

    // ── Salary link. Only the Staff screens send these; the generic Edit screen doesn't, so an edit
    // there keeps whatever link the expense already had instead of wiping it.
    const employeeId = input.employeeId !== undefined ? input.employeeId : (existing?.employeeId ?? null);
    const payMonth = input.payMonth !== undefined ? input.payMonth : (existing?.payMonth ?? null);
    const payKind = input.payKind !== undefined ? input.payKind : (existing?.payKind ?? null);
    const partnerId = input.partnerId !== undefined ? input.partnerId : (existing?.partnerId ?? null);
    if (partnerId) {
      if (input.type !== "expense") throw new VoucherError("Only an expense can be a partner payment.");
      const [pt] = await tx.select({ id: partners.id }).from(partners).where(and(eq(partners.id, partnerId), eq(partners.firmId, firmId)));
      if (!pt) throw new VoucherError("That partner no longer exists.");
      if (!payMonth) throw new VoucherError("A partner payment needs the month it is for.");
    }
    if (employeeId) {
      if (input.type !== "expense") throw new VoucherError("Only an expense can be a salary payment.");
      const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.firmId, firmId)));
      if (!emp) throw new VoucherError("That employee no longer exists.");
      if (!payMonth || !payKind) throw new VoucherError("A salary payment needs its month and whether it's an advance.");
    }

    // ── Lines and tax
    const lineInputs = info.hasLines ? input.lines : [];
    if (info.hasLines && lineInputs.length === 0) throw new VoucherError("Add at least one item or line.");
    if (lineInputs.some((l) => l.qtyMilli <= 0 && input.type !== "expense" && input.type !== "other_income")) {
      throw new VoucherError("Quantity must be more than zero on every line.");
    }

    const itemIds = [...new Set(lineInputs.map((l) => l.itemId).filter((x): x is number => !!x))];
    if (input.type === "stock_transfer" && input.itemSalePrices?.length) {
      for (const p of input.itemSalePrices) {
        if (!itemIds.includes(p.itemId)) continue;
        const [it] = await tx.select({ name: items.name, salePricePaise: items.salePricePaise }).from(items).where(and(eq(items.id, p.itemId), eq(items.firmId, firmId)));
        if (!it || it.salePricePaise === p.salePricePaise) continue;
        await tx.update(items).set({ salePricePaise: p.salePricePaise, updatedAt: new Date() }).where(eq(items.id, p.itemId));
        await audit(tx as unknown as DB, { firmId, userId, action: "update", entity: "item", entityId: p.itemId, summary: `Sale price of ${it.name} changed from ${(it.salePricePaise / 100).toFixed(2)} to ${(p.salePricePaise / 100).toFixed(2)} (on a stock transfer)` });
      }
    }
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
      ["stock_adjustment", "stock_transfer", "delivery_challan"].includes(input.type) ? true : input.withoutTax || composition;

    const normalizedLines = lineInputs.map((l) => {
      const t = l.taxRateId ? taxMap.get(l.taxRateId) : undefined;
      // Stock moves from the warehouse to the shops at the SALE rate: purchase rates are for buying only, so a
      // transfer line is always priced from the item's sale price, whatever the form sent.
      const item = l.itemId ? itemMap.get(l.itemId) : undefined;
      const atSale =
        input.type === "stock_transfer" && item
          ? { ratePaise: Math.round((item.salePricePaise * (l.unitFactorMilli || 1000)) / 1000), rateIncludesTax: false, discountBp: 0, discountPaise: 0 }
          : {};
      return {
        ...l,
        ...atSale,
        gstBp: t ? t.gstBp : l.gstBp,
        cessBp: t ? t.cessBp : l.cessBp,
        qtyMilli: input.type === "expense" || input.type === "other_income" ? Math.max(l.qtyMilli, 1000) : l.qtyMilli,
      };
    });

    const calc = calculateVoucher({
      supply: supplyFor(firm.country, firm.stateCode, placeOfSupply),
      roundOff: info.hasLines && !["stock_adjustment", "stock_transfer"].includes(input.type) ? input.roundOff : false,
      targetTotalPaise: input.type === "purchase_bill" ? (input.matchTotalPaise ?? undefined) : undefined,
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
    if (info.hasLines && !["stock_adjustment", "stock_transfer"].includes(input.type) && totalPaise < 0) {
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
    let srcs: { id: number; partyId: number | null; status: string; locationId: number | null }[] = [];
    if (sourceIds.length) {
      srcs = await tx.select({ id: vouchers.id, partyId: vouchers.partyId, status: vouchers.status, locationId: vouchers.locationId }).from(vouchers).where(and(inArray(vouchers.id, sourceIds), eq(vouchers.firmId, firmId)));
      if (srcs.length !== sourceIds.length || srcs.some((s) => s.status === "deleted")) throw new VoucherError("The source document no longer exists.");
      if (party && srcs.some((s) => s.partyId && s.partyId !== party.id)) throw new VoucherError("All the documents combined into one bill must be for the same party.");
    }
    if (input.type === "money_transfer" && !input.toAccountId) throw new VoucherError("Choose the account to move money into.", "toAccountId");

    // ── Returns: cap each line at what's left to return (sold minus already returned).
    if (["credit_note", "debit_note"].includes(input.type) && sourceIds.length) {
      const sourceId = sourceIds[0];
      const [sold, alreadyReturned] = await Promise.all([
        soldQtyByItem(tx, sourceId),
        returnedQtyByItem(tx, sourceId, input.id),
      ]);
      for (const l of normalizedLines) {
        if (!l.itemId) continue;
        const remaining = (sold.get(l.itemId) ?? 0) - (alreadyReturned.get(l.itemId) ?? 0);
        const wanted = baseQty(l);
        if (wanted > remaining) {
          const name = itemMap.get(l.itemId)?.name ?? "item";
          const already = alreadyReturned.get(l.itemId) ?? 0;
          throw new VoucherError(
            remaining <= 0
              ? `"${name}" has already been fully returned against this bill.`
              : `Only ${formatQty(remaining)} of "${name}" can still be returned (${formatQty(already)} already returned).`,
          );
        }
      }
    }

    // ── Location (shop/warehouse). Falls back to a sensible default (e.g. for older clients or a
    // single-location company) except for transfers, which always need both ends picked explicitly.
    if (input.type === "stock_transfer" && !input.toLocationId) throw new VoucherError("Choose the shop to transfer into.", "toLocationId");
    if (input.type === "stock_transfer" && input.locationId && input.locationId === input.toLocationId) {
      throw new VoucherError("Choose two different shops for the transfer.", "toLocationId");
    }
    // Same single default for every type when none is given, so a company that hasn't set up
    // multiple shops yet keeps behaving like one stock pool. Returns default to the shop the
    // original bill was from; payments/expenses get a shop too (best-effort) so the daily report
    // can attribute cash to the right shop.
    let resolvedLocationId: number | null = input.locationId ?? null;
    if (!resolvedLocationId) {
      const required = needsLocation(input.type);
      const optional = !required && ["payment_in", "payment_out", "expense", "other_income"].includes(input.type);
      if (required || optional) {
        const srcLocationId = ["credit_note", "debit_note"].includes(input.type) && sourceIds.length ? srcs.find((s) => s.id === sourceIds[0])?.locationId ?? null : null;
        resolvedLocationId = srcLocationId ?? (await defaultLocationId(tx, firmId, "warehouse"));
        if (required && !resolvedLocationId) throw new VoucherError("Set up a warehouse or shop first (Settings › Shops & warehouse).", "locationId");
      }
    }
    const locationIds = [resolvedLocationId, input.type === "stock_transfer" ? input.toLocationId : null].filter((x): x is number => !!x);
    if (locationIds.length) {
      const own = await tx.select({ id: locations.id }).from(locations).where(and(inArray(locations.id, locationIds), eq(locations.firmId, firmId)));
      if (own.length !== new Set(locationIds).size) throw new VoucherError("Choose a shop from this company.", "locationId");
    }
    const transitLocationId = input.type === "stock_transfer" ? await systemLocationId(tx, firmId, "transit") : null;

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
      locationId: resolvedLocationId,
      toLocationId: input.type === "stock_transfer" ? (input.toLocationId ?? null) : null,
      paymentMode: input.paymentMode,
      paymentRef: input.paymentRef,
      direction: ["stock_adjustment", "money_adjustment"].includes(input.type) ? (input.direction ?? 1) : null,
      categoryId: input.categoryId ?? null,
      sourceVoucherId: sourceIds[0] ?? existing?.sourceVoucherId ?? null,
      itcEligible: input.itcEligible,
      employeeId,
      payMonth: employeeId || partnerId ? payMonth : null,
      payKind: employeeId ? payKind : null,
      partnerId,
      externalRef: input.externalRef !== undefined && input.externalRef !== null ? input.externalRef : (existing?.externalRef ?? null),
      tcsBp,
      tcsPaise,
      tdsBp,
      tdsPaise,
      originalInvoiceNo: input.originalInvoiceNo,
      originalInvoiceDate: input.originalInvoiceDate,
      returnReason: ["credit_note", "debit_note"].includes(input.type) ? (input.returnReason ?? null) : null,
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
                salePricePaise: input.type === "stock_transfer" && item ? item.salePricePaise : null,
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
        locationId: values.locationId,
        toLocationId: values.toLocationId,
        transitLocationId,
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

    // ── Stock warnings (checked at the shop/warehouse stock actually left from)
    const reducesStock =
      (info.posts && ["sale_invoice", "debit_note"].includes(input.type)) ||
      (input.type === "stock_adjustment" && values.direction === -1) ||
      input.type === "stock_transfer";
    if (reducesStock && values.locationId) {
      const goodsIds = itemIds.filter((iid) => itemMap.get(iid)?.kind === "goods");
      if (goodsIds.length) {
        const stock = await tx
          .select({ itemId: stockLedger.itemId, qty: sql<number>`sum(${stockLedger.qtyMilli})::bigint` })
          .from(stockLedger)
          .where(and(inArray(stockLedger.itemId, goodsIds), eq(stockLedger.locationId, values.locationId)))
          .groupBy(stockLedger.itemId);
        for (const s of stock) {
          const qty = Number(s.qty);
          if (qty < 0) {
            const item = itemMap.get(s.itemId)!;
            if (!cfg.allowNegativeStock) {
              throw new VoucherError(`Not enough stock of "${productLabel(item.code, item.name)}" at this shop. Stock would go to ${qty / 1000}.`);
            }
            warnings.push(`Stock of "${productLabel(item.code, item.name)}" at this shop is now ${qty / 1000} (below zero).`);
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

/** Base-unit quantity sold per item on the original bill. */
async function soldQtyByItem(db: DB | Tx, voucherId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ itemId: voucherLines.itemId, qty: sql<number>`coalesce(sum(${voucherLines.qtyMilli} * ${voucherLines.unitFactorMilli} / 1000), 0)::bigint` })
    .from(voucherLines)
    .where(eq(voucherLines.voucherId, voucherId))
    .groupBy(voucherLines.itemId);
  return new Map(rows.filter((r): r is { itemId: number; qty: number } => r.itemId != null).map((r) => [r.itemId, Number(r.qty)]));
}

/** Base-unit quantity already returned against the original bill, across other active credit/debit notes. */
async function returnedQtyByItem(db: DB | Tx, sourceVoucherId: number, excludeVoucherId?: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ itemId: voucherLines.itemId, qty: sql<number>`coalesce(sum(${voucherLines.qtyMilli} * ${voucherLines.unitFactorMilli} / 1000), 0)::bigint` })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(
      and(
        eq(vouchers.sourceVoucherId, sourceVoucherId),
        eq(vouchers.status, "active"),
        inArray(vouchers.type, ["credit_note", "debit_note"]),
        excludeVoucherId ? ne(vouchers.id, excludeVoucherId) : sql`true`,
      ),
    )
    .groupBy(voucherLines.itemId);
  return new Map(rows.filter((r): r is { itemId: number; qty: number } => r.itemId != null).map((r) => [r.itemId, Number(r.qty)]));
}

/** Whether a sale/purchase bill has been partly or fully returned (by quantity, per item). */
export async function returnStatus(db: DB, voucherId: number): Promise<"none" | "partial" | "full"> {
  const [sold, returned] = await Promise.all([soldQtyByItem(db, voucherId), returnedQtyByItem(db, voucherId)]);
  if (sold.size === 0) return "none";
  let anyReturned = false;
  let allFull = true;
  for (const [itemId, qty] of sold) {
    const ret = returned.get(itemId) ?? 0;
    if (ret > 0) anyReturned = true;
    if (ret < qty) allFull = false;
  }
  if (!anyReturned) return "none";
  return allFull ? "full" : "partial";
}

/** How much of each item on a bill can still be returned (base units). Used to cap and pre-fill a return form. */
export async function returnableQtyByItem(db: DB, voucherId: number): Promise<Map<number, number>> {
  const [sold, returned] = await Promise.all([soldQtyByItem(db, voucherId), returnedQtyByItem(db, voucherId)]);
  const out = new Map<number, number>();
  for (const [itemId, qty] of sold) out.set(itemId, Math.max(0, qty - (returned.get(itemId) ?? 0)));
  return out;
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
        locationId: e.locationId,
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

export interface ReceiveLineInput {
  lineId: number;
  /** In the line's own unit (same as the line's qtyMilli), not necessarily the item's base unit. */
  receivedQtyMilli: number;
  damagedQtyMilli: number;
}

/**
 * The destination confirms what actually arrived. Moves stock out of the "in transit" location:
 * the received amount lands at the destination, the damaged amount at the firm's "damaged goods"
 * location, and anything neither received nor damaged (lost or short) simply isn't posted anywhere
 * — a permanent reduction in stock on hand, which (since stock value is derived from the ledger,
 * not tracked separately) shows up as extra cost of goods sold for the period on its own.
 */
export async function receiveTransfer(db: DB, firmId: number, voucherId: number, userId: number, lineInputs: ReceiveLineInput[], receiveNotes: string | null, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.id, voucherId), eq(vouchers.firmId, firmId))).for("update");
    if (!v || v.status !== "active" || v.type !== "stock_transfer") throw new VoucherError("This transfer no longer exists.");
    if (v.receivedAt) throw new VoucherError("This transfer has already been received.");
    if (!v.toLocationId) throw new VoucherError("This transfer has no destination.");
    const [transitLocationId, damagedLocationId] = await Promise.all([systemLocationId(tx, firmId, "transit"), systemLocationId(tx, firmId, "damaged")]);
    if (!transitLocationId) throw new VoucherError("Set up an In transit location first.");

    const vLines = await tx.select().from(voucherLines).where(eq(voucherLines.voucherId, voucherId)).orderBy(asc(voucherLines.lineNo));
    const byId = new Map(lineInputs.map((l) => [l.lineId, l]));
    const stockRows: (typeof stockLedger.$inferInsert)[] = [];
    const lineUpdates: { id: number; receivedQtyMilli: number; damagedQtyMilli: number }[] = [];
    const today = todayIST();
    let anyDamaged = false;

    for (const l of vLines) {
      if (!l.itemId) continue; // a description-only line never moved stock
      const input = byId.get(l.id);
      if (!input) throw new VoucherError(`Missing received/damaged quantity for "${l.description}".`);
      if (input.receivedQtyMilli < 0 || input.damagedQtyMilli < 0) throw new VoucherError(`Quantities can't be negative, on "${l.description}".`);
      if (input.receivedQtyMilli + input.damagedQtyMilli > l.qtyMilli) {
        throw new VoucherError(`Received + damaged is more than the ${formatQty(l.qtyMilli)} sent, on "${l.description}".`);
      }
      const sentBase = baseQty({ qtyMilli: l.qtyMilli, unitFactorMilli: l.unitFactorMilli });
      const receivedBase = baseQty({ qtyMilli: input.receivedQtyMilli, unitFactorMilli: l.unitFactorMilli });
      const damagedBase = baseQty({ qtyMilli: input.damagedQtyMilli, unitFactorMilli: l.unitFactorMilli });
      const valuePerBase = sentBase > 0 ? l.taxablePaise / sentBase : 0;
      const receivedValue = Math.round(valuePerBase * receivedBase);
      const damagedValue = Math.round(valuePerBase * damagedBase);

      // The full amount sent leaves transit, whatever the split — a shortage doesn't stay parked there.
      stockRows.push({ source: "voucher", voucherId, lineId: l.id, itemId: l.itemId, locationId: transitLocationId, date: today, qtyMilli: -sentBase, valuePaise: -l.taxablePaise, batchNo: l.batchNo, expiryDate: l.expiryDate });
      if (receivedBase > 0) {
        stockRows.push({ source: "voucher", voucherId, lineId: l.id, itemId: l.itemId, locationId: v.toLocationId, date: today, qtyMilli: receivedBase, valuePaise: receivedValue, batchNo: l.batchNo, expiryDate: l.expiryDate });
      }
      if (damagedBase > 0) {
        if (!damagedLocationId) throw new VoucherError("Set up a Damaged goods location first.");
        anyDamaged = true;
        stockRows.push({ source: "voucher", voucherId, lineId: l.id, itemId: l.itemId, locationId: damagedLocationId, date: today, qtyMilli: damagedBase, valuePaise: damagedValue, batchNo: l.batchNo, expiryDate: l.expiryDate });
      }
      lineUpdates.push({ id: l.id, receivedQtyMilli: input.receivedQtyMilli, damagedQtyMilli: input.damagedQtyMilli });
    }

    if (stockRows.length) await tx.insert(stockLedger).values(stockRows);
    for (const u of lineUpdates) {
      await tx.update(voucherLines).set({ receivedQtyMilli: u.receivedQtyMilli, damagedQtyMilli: u.damagedQtyMilli }).where(eq(voucherLines.id, u.id));
    }
    const notes = receiveNotes ? `${v.notes ? `${v.notes}\n\n` : ""}Received: ${receiveNotes}` : v.notes;
    await tx.update(vouchers).set({ receivedAt: new Date(), receivedBy: userId, notes, updatedBy: userId, updatedAt: new Date() }).where(eq(vouchers.id, voucherId));

    const shortBase = lineUpdates.reduce((s, u, i) => {
      const l = vLines.find((x) => x.id === u.id)!;
      return s + baseQty({ qtyMilli: l.qtyMilli, unitFactorMilli: l.unitFactorMilli }) - baseQty({ qtyMilli: u.receivedQtyMilli, unitFactorMilli: l.unitFactorMilli }) - baseQty({ qtyMilli: u.damagedQtyMilli, unitFactorMilli: l.unitFactorMilli });
    }, 0);
    await audit(tx, {
      firmId,
      userId,
      action: "update",
      entity: "voucher",
      entityId: voucherId,
      summary: `Received transfer ${voucherNumber(v)}${anyDamaged ? " (some damaged)" : ""}${shortBase > 0 ? ` (${formatQty(shortBase)} short)` : ""}`,
      ip,
    });
    return { id: voucherId, number: voucherNumber(v) };
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

export async function listDeletedVouchers(db: DB, firmId: number, opts: { hideSalaries?: boolean; hidePartners?: boolean } = {}) {
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
    .where(and(eq(vouchers.firmId, firmId), eq(vouchers.status, "deleted"), opts.hideSalaries ? sql`${vouchers.employeeId} is null` : undefined, opts.hidePartners ? sql`${vouchers.partnerId} is null` : undefined))
    .orderBy(desc(vouchers.deletedAt));
}

export async function getVoucher(db: DB | Tx, firmId: number, id: number) {
  const [v] = await db.select().from(vouchers).where(and(eq(vouchers.id, id), eq(vouchers.firmId, firmId), ne(vouchers.status, "deleted")));
  if (!v) return null;
  // Each line carries its product's current ID (free-text lines have none). Looked up, not stored: it follows the product if the ID is changed.
  const lineRows = await db.select({ line: voucherLines, itemCode: items.code }).from(voucherLines).leftJoin(items, eq(items.id, voucherLines.itemId)).where(eq(voucherLines.voucherId, id)).orderBy(asc(voucherLines.lineNo));
  const lines = lineRows.map((r) => ({ ...r.line, itemCode: r.itemCode }));
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
  const pick = { id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date, totalPaise: vouchers.totalPaise };
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
