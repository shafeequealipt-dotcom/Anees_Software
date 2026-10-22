import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { items, voucherLines } from "@/db/schema";
import type { getVoucher } from "./vouchers";

/*
 * Stock transfers carry the cost (purchase price) of what moved, for the stock and the books. Shop staff who may not
 * see purchase prices (their role lacks "Purchase prices of items") see a transfer at SELLING price instead: each
 * line at the selling price recorded when it was sent (or the item's current one for older transfers), with the
 * totals re-added and no cost, discount or tax figures anywhere.
 */

type VoucherData = NonNullable<Awaited<ReturnType<typeof getVoucher>>>;

/** True when this person must see a transfer at selling price rather than cost. */
export const sellingOnly = (type: string, canSeeCost: boolean) => type === "stock_transfer" && !canSeeCost;

export async function sellingView(db: DB, firmId: number, data: VoucherData): Promise<VoucherData> {
  const missing = [...new Set(data.lines.filter((l) => l.salePricePaise == null && l.itemId).map((l) => l.itemId!))];
  const current = missing.length ? await db.select({ id: items.id, salePricePaise: items.salePricePaise }).from(items).where(and(eq(items.firmId, firmId), inArray(items.id, missing))) : [];
  const now = new Map(current.map((i) => [i.id, i.salePricePaise]));
  const lines = data.lines.map((l) => {
    const perBase = l.salePricePaise ?? (l.itemId ? (now.get(l.itemId) ?? 0) : 0);
    const rate = Math.round((perBase * (l.unitFactorMilli || 1000)) / 1000);
    const total = Math.round((l.qtyMilli * rate) / 1000);
    return { ...l, ratePaise: rate, rateIncludesTax: false, discountBp: 0, lineDiscountPaise: 0, billDiscountPaise: 0, grossPaise: total, taxablePaise: total, gstBp: 0, cessBp: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0, totalPaise: total };
  });
  const total = lines.reduce((s, l) => s + l.totalPaise, 0);
  const voucher = { ...data.voucher, grossPaise: total, discountPaise: 0, taxablePaise: total, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0, roundOffPaise: 0, tcsPaise: 0, tdsPaise: 0, totalPaise: total };
  return { ...data, voucher, lines };
}

/** List rows (transfers) with their totals re-added at selling price, for the list and its Excel export. */
export async function withSellingTotals<T extends { id: number; total_paise: number; taxable_paise: number; tax_paise: number }>(db: DB, firmId: number, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const lines = await db
    .select({ voucherId: voucherLines.voucherId, qtyMilli: voucherLines.qtyMilli, unitFactorMilli: voucherLines.unitFactorMilli, sale: voucherLines.salePricePaise, itemSale: items.salePricePaise })
    .from(voucherLines)
    .leftJoin(items, and(eq(items.id, voucherLines.itemId), eq(items.firmId, firmId)))
    .where(inArray(voucherLines.voucherId, rows.map((r) => r.id)));
  const totals = new Map<number, number>();
  for (const l of lines) {
    const rate = Math.round(((l.sale ?? l.itemSale ?? 0) * (l.unitFactorMilli || 1000)) / 1000);
    totals.set(l.voucherId, (totals.get(l.voucherId) ?? 0) + Math.round((l.qtyMilli * rate) / 1000));
  }
  return rows.map((r) => ({ ...r, total_paise: totals.get(r.id) ?? 0, taxable_paise: totals.get(r.id) ?? 0, tax_paise: 0 }));
}

/**
 * A transfer saved by someone who can't see purchase prices: whatever price their form showed (the selling price),
 * each line is stored at the item's cost, so stock and the books stay at cost.
 */
type CostLine = { itemId?: number | null; ratePaise: number; rateIncludesTax?: boolean; unitFactorMilli?: number };
export async function withCostRates<T extends { lines?: CostLine[] }>(db: DB, firmId: number, input: T): Promise<T> {
  if (!input.lines?.length) return input;
  const ids = [...new Set(input.lines.map((l) => l.itemId).filter((x): x is number => !!x))];
  const rows = ids.length ? await db.select({ id: items.id, cost: items.purchasePricePaise, incl: items.purchasePriceIncludesTax }).from(items).where(and(eq(items.firmId, firmId), inArray(items.id, ids))) : [];
  const cost = new Map(rows.map((r) => [r.id, r]));
  return {
    ...input,
    lines: input.lines.map((l) => {
      const c = l.itemId ? cost.get(l.itemId) : undefined;
      return c ? { ...l, ratePaise: Math.round((c.cost * (l.unitFactorMilli || 1000)) / 1000), rateIncludesTax: c.incl } : { ...l, ratePaise: 0 };
    }),
  };
}
