import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { accounts, items, ledgerCategories, users, voucherLines, vouchers, VOUCHER_TYPES } from "@/db/schema";
import { VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import { MasterError } from "./errors";

/*
 * Reading bills back out through the bookkeeping API (GET /api/v1/bills), so a program can check what is
 * in the books against the source documents: which bills are there, what was read off them, and how much
 * is still owed. Read-only; one company (the key's). Money is in paise, quantities are plain numbers.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-14.");
export const billsQuery = z.object({
  type: z
    .string()
    .default("purchase_bill")
    .transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean))
    .pipe(z.array(z.enum(VOUCHER_TYPES, { message: `type is one or more of: ${VOUCHER_TYPES.join(", ")}.` })).min(1)),
  from: day.optional(),
  to: day.optional(),
  status: z.enum(["active", "all"]).default("active"),
  lines: z.enum(["0", "1"]).default("1"),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const milliToQty = (m: number) => m / 1000;

/** Bills of one company, newest last, with their lines unless `lines=0`. */
export async function apiBills(db: DB, firmId: number, params: Record<string, string>) {
  const parsed = billsQuery.safeParse(params);
  if (!parsed.success) throw new MasterError(parsed.error.issues[0].message);
  const q = parsed.data;
  if (q.from && q.to && q.from > q.to) throw new MasterError("from must be on or before to.");

  const where = and(
    eq(vouchers.firmId, firmId),
    inArray(vouchers.type, q.type),
    q.status === "active" ? eq(vouchers.status, "active") : undefined,
    q.from ? gte(vouchers.date, q.from) : undefined,
    q.to ? lte(vouchers.date, q.to) : undefined,
  );

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int`.mapWith(Number) }).from(vouchers).where(where);
  const rows = await db
    .select({
      id: vouchers.id,
      type: vouchers.type,
      prefix: vouchers.prefix,
      number: vouchers.number,
      date: vouchers.date,
      dueDate: vouchers.dueDate,
      status: vouchers.status,
      partyId: vouchers.partyId,
      partyName: vouchers.partyName,
      partyGstin: vouchers.partyGstin,
      placeOfSupply: vouchers.placeOfSupply,
      billNo: vouchers.supplierInvoiceNo,
      taxablePaise: vouchers.taxablePaise,
      cgstPaise: vouchers.cgstPaise,
      sgstPaise: vouchers.sgstPaise,
      igstPaise: vouchers.igstPaise,
      cessPaise: vouchers.cessPaise,
      roundOffPaise: vouchers.roundOffPaise,
      totalPaise: vouchers.totalPaise,
      paidPaise: vouchers.paidPaise,
      tdsPaise: vouchers.tdsPaise,
      allocated: sql<number>`coalesce((select sum(a.amount_paise) from allocations a where a.to_voucher_id = ${vouchers.id}), 0)::bigint`.mapWith(Number),
      account: accounts.name,
      paymentMode: vouchers.paymentMode,
      paymentRef: vouchers.paymentRef,
      category: ledgerCategories.name,
      notes: vouchers.notes,
      externalRef: vouchers.externalRef,
      fromTelegram: sql<boolean>`exists (select 1 from telegram_drafts d where d.voucher_id = ${vouchers.id})`,
      enteredBy: users.name,
      createdAt: vouchers.createdAt,
    })
    .from(vouchers)
    .leftJoin(accounts, eq(accounts.id, vouchers.accountId))
    .leftJoin(ledgerCategories, eq(ledgerCategories.id, vouchers.categoryId))
    .leftJoin(users, eq(users.id, vouchers.createdBy))
    .where(where)
    .orderBy(asc(vouchers.date), asc(vouchers.id))
    .limit(q.limit)
    .offset(q.offset);

  const linesBy = new Map<number, ReturnType<typeof lineOut>[]>();
  if (q.lines === "1" && rows.length) {
    const ls = await db
      .select({
        voucherId: voucherLines.voucherId,
        lineNo: voucherLines.lineNo,
        itemId: voucherLines.itemId,
        itemCode: items.code,
        itemName: items.name,
        description: voucherLines.description,
        hsn: voucherLines.hsn,
        qtyMilli: voucherLines.qtyMilli,
        unit: voucherLines.unitCode,
        ratePaise: voucherLines.ratePaise,
        rateIncludesTax: voucherLines.rateIncludesTax,
        discountBp: voucherLines.discountBp,
        taxablePaise: voucherLines.taxablePaise,
        gstBp: voucherLines.gstBp,
        cgstPaise: voucherLines.cgstPaise,
        sgstPaise: voucherLines.sgstPaise,
        igstPaise: voucherLines.igstPaise,
        cessPaise: voucherLines.cessPaise,
        totalPaise: voucherLines.totalPaise,
        batchNo: voucherLines.batchNo,
        expiryDate: voucherLines.expiryDate,
      })
      .from(voucherLines)
      .leftJoin(items, eq(items.id, voucherLines.itemId))
      .where(inArray(voucherLines.voucherId, rows.map((r) => r.id)))
      .orderBy(asc(voucherLines.voucherId), asc(voucherLines.lineNo));
    for (const l of ls) {
      const list = linesBy.get(l.voucherId) ?? [];
      list.push(lineOut(l));
      linesBy.set(l.voucherId, list);
    }
  }

  const bills = rows.map((r) => {
    const settled = r.paidPaise + r.tdsPaise + r.allocated;
    return {
      id: r.id,
      type: r.type,
      number: voucherNumber(r),
      date: r.date,
      dueDate: r.dueDate,
      status: r.status,
      party: r.partyName || r.partyId ? { id: r.partyId, name: r.partyName, gstin: r.partyGstin } : null,
      billNo: r.billNo,
      placeOfSupply: r.placeOfSupply,
      taxablePaise: r.taxablePaise,
      cgstPaise: r.cgstPaise,
      sgstPaise: r.sgstPaise,
      igstPaise: r.igstPaise,
      cessPaise: r.cessPaise,
      roundOffPaise: r.roundOffPaise,
      totalPaise: r.totalPaise,
      paidPaise: settled,
      balancePaise: Math.max(0, r.totalPaise - settled),
      account: r.account,
      paymentMode: r.paymentMode,
      paymentRef: r.paymentRef,
      category: r.category,
      notes: r.notes,
      enteredVia: r.fromTelegram ? "telegram" : r.externalRef ? "api" : "app",
      enteredBy: r.enteredBy,
      ref: r.externalRef,
      createdAt: r.createdAt,
      link: `${VOUCHER_INFO[r.type].path}/${r.id}`,
      ...(q.lines === "1" ? { lines: linesBy.get(r.id) ?? [] } : {}),
    };
  });
  return { total: n, limit: q.limit, offset: q.offset, bills };
}

function lineOut(l: {
  lineNo: number;
  itemId: number | null;
  itemCode: string | null;
  itemName: string | null;
  description: string;
  hsn: string | null;
  qtyMilli: number;
  unit: string | null;
  ratePaise: number;
  rateIncludesTax: boolean;
  discountBp: number;
  taxablePaise: number;
  gstBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalPaise: number;
  batchNo: string | null;
  expiryDate: string | null;
}) {
  return {
    lineNo: l.lineNo,
    item: l.itemId ? { id: l.itemId, code: l.itemCode, name: l.itemName } : null,
    description: l.description,
    hsn: l.hsn,
    qty: milliToQty(l.qtyMilli),
    unit: l.unit,
    ratePaise: l.ratePaise,
    rateIncludesTax: l.rateIncludesTax,
    discountPct: l.discountBp / 100,
    taxablePaise: l.taxablePaise,
    gstPct: l.gstBp / 100,
    cgstPaise: l.cgstPaise,
    sgstPaise: l.sgstPaise,
    igstPaise: l.igstPaise,
    cessPaise: l.cessPaise,
    totalPaise: l.totalPaise,
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
  };
}
