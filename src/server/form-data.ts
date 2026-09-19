import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { rows, nums } from "@/db/query";
import { accounts, firms, ledgerCategories, taxRates, vouchers, type VoucherType } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { getVoucher } from "./vouchers";

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
  stockMilli: number;
}

export async function loadPartyOptions(db: DB): Promise<PartyOpt[]> {
  return nums(
    await rows<PartyOpt>(
      db,
      sql`select p.id, p.name, p.phone, p.gstin, p.state_code as "stateCode", p.billing_address as "billingAddress",
            p.shipping_address as "shippingAddress", p.kind, p.credit_days as "creditDays",
            coalesce((select sum(l.amount_paise) from party_ledger l where l.party_id = p.id), 0) as "balancePaise"
          from parties p where p.active order by lower(p.name)`,
    ),
    ["balancePaise"],
  );
}

export async function loadItemOptions(db: DB): Promise<ItemOpt[]> {
  return nums(
    await rows<ItemOpt>(
      db,
      sql`select i.id, i.name, i.code, i.hsn, i.kind, u.code as "unitCode", au.code as "altUnitCode", i.alt_unit_factor_milli as "altFactorMilli",
            i.sale_price_paise as "salePricePaise", i.sale_price_includes_tax as "saleIncl",
            i.purchase_price_paise as "purchasePricePaise", i.purchase_price_includes_tax as "purchaseIncl",
            i.mrp_paise as "mrpPaise", i.tax_rate_id as "taxRateId",
            coalesce((select sum(s.qty_milli) from stock_ledger s where s.item_id = i.id), 0) as "stockMilli"
          from items i left join units u on u.id = i.unit_id left join units au on au.id = i.alt_unit_id
          where i.active order by lower(i.name)`,
    ),
    ["salePricePaise", "purchasePricePaise", "mrpPaise", "altFactorMilli", "stockMilli"],
  );
}

export async function loadVoucherFormData(db: DB, type: VoucherType, opts: { id?: number; fromId?: number; partyId?: number }) {
  const info = VOUCHER_INFO[type];
  const [firm] = await db.select().from(firms).where(eq(firms.isDefault, true));
  const settings = await getSettings(db);
  const [partyOptions, itemOptions, taxes, accountList, categories] = await Promise.all([
    info.partySide === "none" ? Promise.resolve([]) : loadPartyOptions(db),
    info.hasLines ? loadItemOptions(db) : Promise.resolve([]),
    db.select().from(taxRates).where(eq(taxRates.active, true)).orderBy(asc(taxRates.sort)),
    db.select({ id: accounts.id, name: accounts.name, kind: accounts.kind, isDefault: accounts.isDefault }).from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.kind), asc(accounts.name)),
    type === "expense" || type === "other_income"
      ? db.select().from(ledgerCategories).where(eq(ledgerCategories.kind, type === "expense" ? "expense" : "income")).orderBy(asc(ledgerCategories.name))
      : Promise.resolve([]),
  ]);

  const existing = opts.id ? await getVoucher(db, opts.id) : null;
  const source = !existing && opts.fromId ? await getVoucher(db, opts.fromId) : null;

  const [next] = await db
    .select({ n: sql<number>`coalesce(max(${vouchers.number}), 0)::int + 1` })
    .from(vouchers)
    .where(sql`${vouchers.type} = ${type} and ${vouchers.prefix} = ${settings.prefixes[type] ?? ""}`);

  return {
    type,
    firm: firm ? { country: firm.country, stateCode: firm.stateCode, gstScheme: firm.gstScheme, terms: firm.invoiceTerms } : null,
    settings: {
      roundOff: settings.roundOff,
      lineDiscount: settings.lineDiscount,
      billDiscount: settings.billDiscount,
      defaultPriceIncludesTax: settings.defaultPriceIncludesTax,
      showMrp: settings.showMrp,
      batchTracking: settings.batchTracking,
      prefix: existing?.voucher.prefix ?? settings.prefixes[type] ?? "",
      quotationTerms: settings.quotationTerms,
    },
    nextNumber: next.n,
    parties: partyOptions,
    items: itemOptions,
    taxes: taxes.map((t) => ({ id: t.id, name: t.name, gstBp: t.gstBp, cessBp: t.cessBp })),
    accounts: accountList,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    existing,
    source,
    presetPartyId: opts.partyId ?? null,
  };
}

export type VoucherFormData = Awaited<ReturnType<typeof loadVoucherFormData>>;
