import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { rows, nums } from "@/db/query";
import { accounts, firms, ledgerCategories, taxRates, vouchers, type VoucherType } from "@/db/schema";
import { emptyPricing } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { loadPricing } from "./pricing";
import { getVoucher, returnableQtyByItem } from "./vouchers";

export interface PartyOpt {
  id: number;
  name: string;
  phone: string | null;
  gstin: string | null;
  stateCode: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  kind: string;
  creditDays: number | null;
  priceListId: number | null;
  balancePaise: number;
}

export interface ItemOpt {
  id: number;
  name: string;
  code: string | null;
  hsn: string | null;
  kind: "goods" | "service";
  unitCode: string | null;
  altUnitCode: string | null;
  altFactorMilli: number | null;
  salePricePaise: number;
  saleIncl: boolean;
  purchasePricePaise: number;
  purchaseIncl: boolean;
  mrpPaise: number | null;
  taxRateId: number | null;
  /** Company-wide total. */
  stockMilli: number;
  /** Per shop/warehouse (location id → qty), so the form can show stock at whichever shop is selected. */
  stockByLocation: Record<number, number>;
}

export async function loadPartyOptions(db: DB, firmId: number): Promise<PartyOpt[]> {
  return nums(
    await rows<PartyOpt>(
      db,
      sql`select p.id, p.name, p.phone, p.gstin, p.state_code as "stateCode", p.billing_address as "billingAddress",
            p.shipping_address as "shippingAddress", p.kind, p.credit_days as "creditDays", p.price_list_id as "priceListId",
            coalesce((select sum(l.amount_paise) from party_ledger l where l.party_id = p.id), 0) as "balancePaise"
          from parties p where p.firm_id = ${firmId} and p.active order by lower(p.name)`,
    ),
    ["balancePaise"],
  );
}

export async function loadItemOptions(db: DB, firmId: number): Promise<ItemOpt[]> {
  const list = nums(
    await rows<ItemOpt>(
      db,
      sql`select i.id, i.name, i.code, i.hsn, i.kind, u.code as "unitCode", au.code as "altUnitCode", i.alt_unit_factor_milli as "altFactorMilli",
            i.sale_price_paise as "salePricePaise", i.sale_price_includes_tax as "saleIncl",
            i.purchase_price_paise as "purchasePricePaise", i.purchase_price_includes_tax as "purchaseIncl",
            i.mrp_paise as "mrpPaise", i.tax_rate_id as "taxRateId",
            coalesce((select sum(s.qty_milli) from stock_ledger s where s.item_id = i.id), 0) as "stockMilli",
            coalesce((select jsonb_object_agg(t.location_id, t.qty) from (select location_id, sum(qty_milli) as qty from stock_ledger where item_id = i.id group by location_id) t), '{}'::jsonb) as "stockByLocation"
          from items i left join units u on u.id = i.unit_id left join units au on au.id = i.alt_unit_id
          where i.firm_id = ${firmId} and i.active order by lower(i.name)`,
    ),
    ["salePricePaise", "purchasePricePaise", "mrpPaise", "altFactorMilli", "stockMilli"],
  );
  // jsonb comes back already parsed on most drivers, but not all — normalize defensively.
  for (const r of list) {
    const raw = r.stockByLocation as unknown;
    r.stockByLocation = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  }
  return list;
}

export interface Visibility {
  balance: boolean;
  contact: boolean;
  purchase: boolean;
}

export interface LocationOpt {
  id: number;
  name: string;
  kind: "warehouse" | "shop";
}

/**
 * Pre-fills a return with only what's still returnable: caps (or drops) each line so the form
 * never opens already over the limit. The server re-checks this authoritatively on save, since
 * another return could be made between opening this form and saving it.
 */
async function capReturnLines<T extends { itemId: number | null; qtyMilli: number; unitFactorMilli: number }>(db: DB, sourceVoucherId: number, lines: T[]): Promise<T[]> {
  const remaining = await returnableQtyByItem(db, sourceVoucherId);
  const out: T[] = [];
  for (const l of lines) {
    if (!l.itemId) {
      out.push(l);
      continue;
    }
    const left = remaining.get(l.itemId) ?? 0;
    const originalBase = Math.round((l.qtyMilli * (l.unitFactorMilli || 1000)) / 1000);
    const capped = Math.min(originalBase, left);
    if (capped <= 0) continue;
    remaining.set(l.itemId, left - capped);
    const cappedLineQty = Math.round((capped * 1000) / (l.unitFactorMilli || 1000));
    out.push(cappedLineQty === l.qtyMilli ? l : { ...l, qtyMilli: cappedLineQty });
  }
  return out;
}

export async function loadVoucherFormData(
  db: DB,
  firmId: number,
  type: VoucherType,
  opts: { id?: number; fromId?: number; fromIds?: number[]; partyId?: number },
  see: Visibility,
  myLocations: LocationOpt[] = [],
) {
  const info = VOUCHER_INFO[type];
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  const settings = await getSettings(db, firmId);
  const [partyOptions, itemOptions, taxes, accountList, categories] = await Promise.all([
    info.partySide === "none" ? Promise.resolve([]) : loadPartyOptions(db, firmId),
    info.hasLines ? loadItemOptions(db, firmId) : Promise.resolve([]),
    db.select().from(taxRates).where(and(eq(taxRates.firmId, firmId), eq(taxRates.active, true))).orderBy(asc(taxRates.sort)),
    db.select({ id: accounts.id, name: accounts.name, kind: accounts.kind, isDefault: accounts.isDefault }).from(accounts).where(and(eq(accounts.firmId, firmId), eq(accounts.active, true))).orderBy(asc(accounts.kind), asc(accounts.name)),
    type === "expense" || type === "other_income"
      ? db.select().from(ledgerCategories).where(and(eq(ledgerCategories.firmId, firmId), eq(ledgerCategories.kind, type === "expense" ? "expense" : "income"))).orderBy(asc(ledgerCategories.name))
      : Promise.resolve([]),
  ]);

  const existing = opts.id ? await getVoucher(db, firmId, opts.id) : null;
  const fromIds = [...new Set(opts.fromIds?.length ? opts.fromIds : opts.fromId ? [opts.fromId] : [])];
  const found = existing ? [] : (await Promise.all(fromIds.map((sid) => getVoucher(db, firmId, sid)))).filter((x): x is NonNullable<typeof x> => !!x);
  // Combined documents must be for the same party as the first one.
  const sources = found.filter((s) => !s.voucher.partyId || !found[0].voucher.partyId || s.voucher.partyId === found[0].voucher.partyId);
  const isReturn = type === "credit_note" || type === "debit_note";
  const sourceLines = isReturn && sources.length ? await capReturnLines(db, sources[0].voucher.id, sources.flatMap((s) => s.lines)) : sources.flatMap((s) => s.lines);
  const source = sources.length ? { ...sources[0], lines: sourceLines } : null;
  const sourceRefs = sources.map((s) => ({ id: s.voucher.id, label: `${s.voucher.prefix}${s.voucher.number}` }));

  const [next] = await db
    .select({ n: sql<number>`coalesce(max(${vouchers.number}), 0)::int + 1` })
    .from(vouchers)
    .where(sql`${vouchers.firmId} = ${firmId} and ${vouchers.type} = ${type} and ${vouchers.prefix} = ${settings.prefixes[type] ?? ""}`);

  return {
    type,
    firm: firm ? { country: firm.country, stateCode: firm.stateCode, gstScheme: firm.gstScheme, terms: firm.invoiceTerms } : null,
    settings: {
      roundOff: settings.roundOff,
      tdsTcsEnabled: settings.tdsTcsEnabled,
      lineDiscount: settings.lineDiscount,
      billDiscount: settings.billDiscount,
      defaultPriceIncludesTax: settings.defaultPriceIncludesTax,
      showMrp: settings.showMrp,
      batchTracking: settings.batchTracking,
      prefix: existing?.voucher.prefix ?? settings.prefixes[type] ?? "",
      quotationTerms: settings.quotationTerms,
    },
    nextNumber: next.n,
    see,
    pricing: info.priceSide === "sale" && info.hasLines ? await loadPricing(db, firmId) : emptyPricing,
    parties: partyOptions.map((p) => ({ ...p, phone: see.contact ? p.phone : null, balancePaise: see.balance ? p.balancePaise : 0 })),
    items: itemOptions.map((i) => ({ ...i, purchasePricePaise: see.purchase ? i.purchasePricePaise : 0 })),
    taxes: taxes.map((t) => ({ id: t.id, name: t.name, gstBp: t.gstBp, cessBp: t.cessBp })),
    accounts: accountList,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    existing,
    source,
    sourceRefs,
    presetPartyId: opts.partyId ?? null,
    locations: myLocations,
    defaultLocationId: existing?.voucher.locationId ?? myLocations[0]?.id ?? null,
  };
}

export type VoucherFormData = Awaited<ReturnType<typeof loadVoucherFormData>>;
