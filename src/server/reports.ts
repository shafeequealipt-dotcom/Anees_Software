import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import type { VoucherType } from "@/db/schema";
import { nums, rows } from "@/db/query";
import { addDays, monthRange, todayIST } from "@/lib/dates";
import { region } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { depreciationBetween } from "./gl";

const settleable = sql`v.type in ('sale_invoice','purchase_bill','credit_note','debit_note','expense','other_income')`;

/** SQL expression: unpaid balance of voucher alias v. */
const balanceExpr = sql`case when ${settleable} and v.party_id is not null and v.status = 'active'
  then v.total_paise - v.tds_paise - v.paid_paise - coalesce((select sum(a.amount_paise) from allocations a where a.to_voucher_id = v.id), 0)
  else 0 end`;

// ─── Voucher lists ───────────────────────────────────────────────────────────

export interface VoucherRow {
  id: number;
  type: VoucherType;
  prefix: string;
  number: number;
  date: string;
  due_date: string | null;
  status: "active" | "cancelled";
  party_id: number | null;
  party_name: string | null;
  total_paise: number;
  paid_paise: number;
  taxable_paise: number;
  tax_paise: number;
  balance_paise: number;
  payment_mode: string | null;
  account_name: string | null;
  category_name: string | null;
  converted: boolean;
  supplier_invoice_no: string | null;
  location_id: number | null;
  to_location_id: number | null;
  location_name: string | null;
  to_location_name: string | null;
  received_at: string | null;
  /** Entered through an API key (recorded as made by the built-in API user). */
  by_api: boolean;
}

/** Restricts to what a location-restricted user may see: their shops' vouchers, plus any without a shop that they themselves entered. */
function locationAccessWhere(locationIds: number[] | undefined, createdBy: number | undefined): SQL | null {
  if (!locationIds) return null;
  if (locationIds.length === 0) return createdBy ? sql`v.location_id is null and v.created_by = ${createdBy}` : sql`false`;
  const ids = sql.join(locationIds.map((id) => sql`${id}`), sql`, `);
  // A stock transfer shows up for either end: the sender's shop and the receiving shop.
  return createdBy
    ? sql`(v.location_id in (${ids}) or v.to_location_id in (${ids}) or (v.location_id is null and v.created_by = ${createdBy}))`
    : sql`(v.location_id in (${ids}) or v.to_location_id in (${ids}))`;
}

export async function listVouchers(
  db: DB,
  firmId: number,
  f: { types: VoucherType[]; from?: string; to?: string; partyId?: number; q?: string; status?: "open" | "paid" | "overdue" | "cancelled" | "all"; limit?: number; accountId?: number; categoryId?: number; locationIds?: number[]; createdBy?: number; hideSalaries?: boolean; hidePartners?: boolean },
): Promise<VoucherRow[]> {
  const where: SQL[] = [sql`v.firm_id = ${firmId}`, sql`v.status <> 'deleted'`, sql`v.type in (${sql.join(f.types.map((t) => sql`${t}`), sql`, `)})`];
  if (f.from) where.push(sql`v.date >= ${f.from}`);
  if (f.to) where.push(sql`v.date <= ${f.to}`);
  if (f.partyId) where.push(sql`v.party_id = ${f.partyId}`);
  if (f.accountId) where.push(sql`(v.account_id = ${f.accountId} or v.to_account_id = ${f.accountId})`);
  if (f.categoryId) where.push(sql`v.category_id = ${f.categoryId}`);
  if (f.q) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    where.push(sql`(lower(coalesce(v.party_name,'')) like ${like} or lower(v.prefix || v.number::text) like ${like} or lower(coalesce(v.supplier_invoice_no,'')) like ${like} or lower(coalesce(v.notes,'')) like ${like})`);
  }
  if (f.status === "cancelled") where.push(sql`v.status = 'cancelled'`);
  else if (f.status && f.status !== "all") where.push(sql`v.status = 'active'`);
  const locWhere = locationAccessWhere(f.locationIds, f.createdBy);
  if (locWhere) where.push(locWhere);
  if (f.hideSalaries) where.push(sql`v.employee_id is null`);
  if (f.hidePartners) where.push(sql`v.partner_id is null`);

  const list = await rows<VoucherRow>(
    db,
    sql`select v.id, v.type, v.prefix, v.number, v.date::text, v.due_date::text, v.status, v.party_id, v.party_name,
          v.total_paise, v.paid_paise, v.taxable_paise, (v.cgst_paise + v.sgst_paise + v.igst_paise + v.cess_paise) as tax_paise,
          ${balanceExpr} as balance_paise, v.payment_mode, a.name as account_name, c.name as category_name,
          (exists(select 1 from vouchers x where x.source_voucher_id = v.id and x.status = 'active')
            or exists(select 1 from voucher_sources vs join vouchers x on x.id = vs.voucher_id where vs.source_id = v.id and x.status = 'active')) as converted,
          v.supplier_invoice_no, v.location_id, v.to_location_id, l1.name as location_name, l2.name as to_location_name, v.received_at::text as received_at,
          coalesce((select u.is_api from users u where u.id = v.created_by), false) as by_api
        from vouchers v
        left join accounts a on a.id = v.account_id
        left join ledger_categories c on c.id = v.category_id
        left join locations l1 on l1.id = v.location_id
        left join locations l2 on l2.id = v.to_location_id
        where ${sql.join(where, sql` and `)}
        order by v.date desc, v.id desc
        limit ${f.limit ?? 1000}`,
  );
  nums(list, ["total_paise", "paid_paise", "taxable_paise", "tax_paise", "balance_paise"]);
  const today = todayIST();
  return list.filter((r) => {
    if (f.status === "open") return r.balance_paise > 0;
    if (f.status === "paid") return r.balance_paise <= 0 && r.status === "active";
    if (f.status === "overdue") return r.balance_paise > 0 && !!r.due_date && r.due_date < today;
    return true;
  });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function dashboard(db: DB, firmId: number, access?: { locationIds: number[]; createdBy: number }) {
  const defaultLowMilli = (await getSettings(db, firmId)).defaultLowStock * 1000;
  const today = todayIST();
  const month = monthRange(today);
  const yearAgo = addDays(month.from, -335).slice(0, 8) + "01";
  const locWhere = locationAccessWhere(access?.locationIds, access?.createdBy);
  const locAnd = locWhere ? sql`and ${locWhere}` : sql``;

  const [balances] = await rows<{ receivable: number; payable: number }>(
    db,
    sql`select coalesce(sum(case when b > 0 then b end), 0) as receivable, coalesce(-sum(case when b < 0 then b end), 0) as payable
        from (select sum(l.amount_paise) as b from party_ledger l join parties p on p.id = l.party_id where p.firm_id = ${firmId} group by l.party_id) t`,
  );
  const money = nums(
    await rows<{ id: number; name: string; kind: string; balance: number }>(
      db,
      sql`select a.id, a.name, a.kind, coalesce(sum(m.amount_paise), 0) as balance
          from accounts a left join money_ledger m on m.account_id = a.id
          where a.active and a.firm_id = ${firmId} group by a.id order by a.kind, a.name`,
    ),
    ["balance"],
  );
  const [monthTotals] = nums(
    await rows<{ sales: number; purchases: number; expenses: number; received: number; paid: number; invoices: number }>(
      db,
      sql`select
            coalesce(sum(case when type = 'sale_invoice' then total_paise when type = 'credit_note' then -total_paise end), 0) as sales,
            coalesce(sum(case when type = 'purchase_bill' then total_paise when type = 'debit_note' then -total_paise end), 0) as purchases,
            coalesce(sum(case when type = 'expense' then total_paise end), 0) as expenses,
            coalesce(sum(case when type = 'payment_in' then total_paise end), 0) as received,
            coalesce(sum(case when type = 'payment_out' then total_paise end), 0) as paid,
            count(*) filter (where type = 'sale_invoice') as invoices
          from vouchers v where firm_id = ${firmId} and status = 'active' and date between ${month.from} and ${month.to} ${locAnd}`,
    ),
    ["sales", "purchases", "expenses", "received", "paid", "invoices"],
  );
  const salesByMonth = nums(
    await rows<{ month: string; sales: number; purchases: number }>(
      db,
      sql`select to_char(date_trunc('month', date), 'YYYY-MM') as month,
            coalesce(sum(case when type = 'sale_invoice' then taxable_paise when type = 'credit_note' then -taxable_paise end), 0) as sales,
            coalesce(sum(case when type = 'purchase_bill' then taxable_paise when type = 'debit_note' then -taxable_paise end), 0) as purchases
          from vouchers v where firm_id = ${firmId} and status = 'active' and date >= ${yearAgo} ${locAnd}
          group by 1 order by 1`,
    ),
    ["sales", "purchases"],
  );
  const [lowStock] = nums(
    await rows<{ n: number }>(
      db,
      sql`select count(*) as n from (
            select i.id, coalesce(nullif(i.min_stock_milli, 0), ${defaultLowMilli}) as min_stock_milli
            from items i left join stock_ledger s on s.item_id = i.id
            where i.firm_id = ${firmId} and i.active and i.kind = 'goods'
            group by i.id, coalesce(nullif(i.min_stock_milli, 0), ${defaultLowMilli})
            having coalesce(sum(s.qty_milli), 0) <= coalesce(nullif(i.min_stock_milli, 0), ${defaultLowMilli})) t`,
    ),
    ["n"],
  );
  const overdue = nums(
    await rows<{ id: number; prefix: string; number: number; party_name: string; due_date: string; balance_paise: number }>(
      db,
      sql`select * from (
            select v.id, v.prefix, v.number, v.party_name, v.due_date::text, ${balanceExpr} as balance_paise
            from vouchers v where v.firm_id = ${firmId} and v.type = 'sale_invoice' and v.status = 'active' and v.due_date < ${today} ${locAnd}) t
          where balance_paise > 0 order by due_date limit 8`,
    ),
    ["balance_paise"],
  );
  const todayByShop = nums(
    await rows<{ location_id: number | null; location_name: string; bills: number; sales: number; returns: number }>(
      db,
      sql`select l.id as location_id, l.name as location_name,
            count(*) filter (where v.type = 'sale_invoice')::int as bills,
            coalesce(sum(v.total_paise) filter (where v.type = 'sale_invoice'), 0) as sales,
            coalesce(sum(v.total_paise) filter (where v.type = 'credit_note'), 0) as returns
          from locations l
          left join vouchers v on v.location_id = l.id and v.status = 'active' and v.type in ('sale_invoice', 'credit_note') and v.date = ${today}
          where l.firm_id = ${firmId} and l.active and l.kind in ('warehouse', 'shop')
          group by l.id, l.name
          order by l.sort, l.id`,
    ),
    ["bills", "sales", "returns"],
  );
  const monthByShop = nums(
    await rows<{ location_id: number | null; location_name: string; bills: number; sales: number; returns: number }>(
      db,
      sql`select l.id as location_id, l.name as location_name,
            count(*) filter (where v.type = 'sale_invoice')::int as bills,
            coalesce(sum(v.total_paise) filter (where v.type = 'sale_invoice'), 0) as sales,
            coalesce(sum(v.total_paise) filter (where v.type = 'credit_note'), 0) as returns
          from locations l
          left join vouchers v on v.location_id = l.id and v.status = 'active' and v.type in ('sale_invoice', 'credit_note') and v.date between ${month.from} and ${month.to}
          where l.firm_id = ${firmId} and l.active and l.kind in ('warehouse', 'shop')
          group by l.id, l.name
          order by l.sort, l.id`,
    ),
    ["bills", "sales", "returns"],
  );
  const pendingWhere = access?.locationIds
    ? access.locationIds.length
      ? sql`and v.to_location_id in (${sql.join(access.locationIds.map((id) => sql`${id}`), sql`, `)})`
      : sql`and false`
    : sql``;
  const [pendingTransfers] = nums(
    await rows<{ n: number }>(
      db,
      sql`select count(*) as n from vouchers v where v.firm_id = ${firmId} and v.type = 'stock_transfer' and v.status = 'active' and v.received_at is null ${pendingWhere}`,
    ),
    ["n"],
  );
  return {
    receivable: Number(balances.receivable),
    payable: Number(balances.payable),
    money,
    month: monthTotals,
    salesByMonth,
    lowStock: lowStock.n,
    overdue,
    todayByShop: todayByShop.map((r) => ({ locationId: r.location_id!, locationName: r.location_name, bills: r.bills, salesPaise: r.sales, returnsPaise: r.returns, netPaise: r.sales - r.returns })),
    monthByShop: monthByShop.map((r) => ({ locationId: r.location_id!, locationName: r.location_name, bills: r.bills, salesPaise: r.sales, returnsPaise: r.returns, netPaise: r.sales - r.returns })),
    monthRange: month,
    pendingTransfers: pendingTransfers.n,
  };
}

// ─── Parties ─────────────────────────────────────────────────────────────────

export interface PartyBalanceRow {
  id: number;
  name: string;
  kind: string;
  phone: string | null;
  gstin: string | null;
  group_name: string | null;
  balance_paise: number;
  active: boolean;
  last_date: string | null;
}

export async function partyBalances(db: DB, firmId: number, f: { q?: string; kind?: string; asOf?: string; includeInactive?: boolean } = {}) {
  const where: SQL[] = [sql`p.firm_id = ${firmId}`];
  if (!f.includeInactive) where.push(sql`p.active`);
  if (f.kind === "customer") where.push(sql`p.kind in ('customer','both')`);
  if (f.kind === "supplier") where.push(sql`p.kind in ('supplier','both')`);
  if (f.q) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    where.push(sql`(lower(p.name) like ${like} or coalesce(p.phone,'') like ${like} or lower(coalesce(p.gstin,'')) like ${like})`);
  }
  const asOf = f.asOf ?? "9999-12-31";
  return nums(
    await rows<PartyBalanceRow>(
      db,
      sql`select p.id, p.name, p.kind, p.phone, p.gstin, g.name as group_name, p.active,
            coalesce((select sum(l.amount_paise) from party_ledger l where l.party_id = p.id and l.date <= ${asOf}), 0) as balance_paise,
            (select max(v.date)::text from vouchers v where v.party_id = p.id and v.status = 'active') as last_date
          from parties p left join party_groups g on g.id = p.group_id
          where ${sql.join(where, sql` and `)}
          order by lower(p.name)`,
    ),
    ["balance_paise"],
  );
}

export interface StatementRow {
  date: string;
  voucher_id: number | null;
  type: VoucherType | null;
  prefix: string | null;
  number: number | null;
  memo: string | null;
  debit_paise: number;
  credit_paise: number;
  balance_paise: number;
  total_paise: number | null;
}

/** Party ledger with running balance. Debit = party owes more; credit = party owes less. */
/** Statements take a record id from the URL: refuse one that belongs to another company, whatever the caller already checked. */
async function assertOwned(db: DB, table: "parties" | "items" | "accounts", id: number, firmId: number) {
  const hit = await rows<{ ok: number }>(db, sql`select 1 as ok from ${sql.raw(table)} where id = ${id} and firm_id = ${firmId}`);
  if (hit.length === 0) throw new Error(`That ${table === "parties" ? "party" : table === "items" ? "item" : "account"} isn't in this company.`);
}

export async function partyStatement(db: DB, firmId: number, partyId: number, from: string, to: string) {
  await assertOwned(db, "parties", partyId, firmId);
  const [opening] = nums(
    await rows<{ b: number }>(db, sql`select coalesce(sum(amount_paise), 0) as b from party_ledger where party_id = ${partyId} and date < ${from}`),
    ["b"],
  );
  const entries = nums(
    await rows<StatementRow>(
      db,
      sql`select l.date::text, l.voucher_id, v.type, v.prefix, v.number, coalesce(l.memo, v.notes) as memo, v.total_paise,
            sum(case when l.amount_paise > 0 then l.amount_paise else 0 end) as debit_paise,
            sum(case when l.amount_paise < 0 then -l.amount_paise else 0 end) as credit_paise
          from party_ledger l left join vouchers v on v.id = l.voucher_id
          where l.party_id = ${partyId} and l.date between ${from} and ${to}
          group by l.date, l.voucher_id, v.type, v.prefix, v.number, coalesce(l.memo, v.notes), v.total_paise, l.source
          order by l.date, l.source desc, l.voucher_id nulls first`,
    ),
    ["debit_paise", "credit_paise", "total_paise"],
  );
  let running = opening.b;
  for (const e of entries) {
    running += e.debit_paise - e.credit_paise;
    e.balance_paise = running;
  }
  return {
    openingPaise: opening.b,
    entries,
    closingPaise: running,
    totalDebitPaise: entries.reduce((s, e) => s + e.debit_paise, 0),
    totalCreditPaise: entries.reduce((s, e) => s + e.credit_paise, 0),
  };
}

// ─── Stock ───────────────────────────────────────────────────────────────────

export interface StockRow {
  id: number;
  name: string;
  code: string | null;
  category_name: string | null;
  unit_code: string | null;
  qty_milli: number;
  min_stock_milli: number;
  purchase_price_paise: number;
  sale_price_paise: number;
  cost_per_unit_paise: number;
  stock_value_paise: number;
  low: boolean;
  active: boolean;
}

/** Cost of one milli-unit of a transfer line's quantity (in the line's own unit); a free-text line at its own value. */
const lineUnitCost = sql`(case when vl.item_id is null then vl.taxable_paise::numeric / nullif(vl.qty_milli, 0)
    else (case when i.purchase_price_includes_tax then round(i.purchase_price_paise * 10000.0 / (10000 + coalesce(t.gst_bp, 0) + coalesce(t.cess_bp, 0))) else i.purchase_price_paise end)
      * coalesce(vl.unit_factor_milli, 1000) / 1000000.0 end)`;

/** Stock value uses the purchase price without tax. */
const costPerUnit = sql`case when i.purchase_price_includes_tax
    then round(i.purchase_price_paise * 10000.0 / (10000 + coalesce(t.gst_bp, 0) + coalesce(t.cess_bp, 0)))
    else i.purchase_price_paise end`;

export async function stockSummary(db: DB, firmId: number, f: { asOf?: string; q?: string; categoryId?: number; lowOnly?: boolean; includeInactive?: boolean; locationId?: number } = {}) {
  const asOf = f.asOf ?? "9999-12-31";
  const defaultLowMilli = (await getSettings(db, firmId)).defaultLowStock * 1000;
  const where: SQL[] = [sql`i.firm_id = ${firmId}`, sql`i.kind = 'goods'`];
  if (!f.includeInactive) where.push(sql`i.active`);
  if (f.categoryId) where.push(sql`i.category_id = ${f.categoryId}`);
  if (f.q) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    where.push(sql`(lower(i.name) like ${like} or lower(coalesce(i.code,'')) like ${like})`);
  }
  // With a shop chosen: that shop's quantity, and its own low-stock level (falling back to the item's).
  const qtySql = f.locationId
    ? sql`coalesce((select sum(s.qty_milli) from stock_ledger s where s.item_id = i.id and s.date <= ${asOf} and s.location_id = ${f.locationId}), 0)`
    : sql`coalesce((select sum(s.qty_milli) from stock_ledger s where s.item_id = i.id and s.date <= ${asOf}), 0)`;
  const minStockSql = f.locationId
    ? sql`coalesce((select ill.min_stock_milli from item_location_levels ill where ill.item_id = i.id and ill.location_id = ${f.locationId}), i.min_stock_milli)`
    : sql`i.min_stock_milli`;
  const list = nums(
    await rows<StockRow>(
      db,
      sql`select i.id, i.name, i.code, c.name as category_name, u.code as unit_code, i.active,
            ${qtySql} as qty_milli,
            ${minStockSql} as min_stock_milli, i.purchase_price_paise, i.sale_price_paise, ${costPerUnit} as cost_per_unit_paise
          from items i
          left join item_categories c on c.id = i.category_id
          left join units u on u.id = i.unit_id
          left join tax_rates t on t.id = i.tax_rate_id
          where ${sql.join(where, sql` and `)}
          order by lower(i.name)`,
    ),
    ["qty_milli", "min_stock_milli", "purchase_price_paise", "sale_price_paise", "cost_per_unit_paise"],
  );
  for (const r of list) {
    r.stock_value_paise = Math.round((Math.max(0, r.qty_milli) * r.cost_per_unit_paise) / 1000);
    if (r.min_stock_milli <= 0) r.min_stock_milli = defaultLowMilli;
    r.low = r.qty_milli <= r.min_stock_milli;
  }
  return f.lowOnly ? list.filter((r) => r.low) : list;
}

export async function itemMovements(db: DB, firmId: number, itemId: number, from: string, to: string) {
  await assertOwned(db, "items", itemId, firmId);
  const [opening] = nums(
    await rows<{ q: number }>(db, sql`select coalesce(sum(qty_milli), 0) as q from stock_ledger where item_id = ${itemId} and date < ${from}`),
    ["q"],
  );
  const entries = nums(
    await rows<{ date: string; voucher_id: number | null; type: VoucherType | null; prefix: string | null; number: number | null; party_name: string | null; qty_milli: number; rate_paise: number | null; batch_no: string | null; balance_milli: number }>(
      db,
      sql`select s.date::text, s.voucher_id, v.type, v.prefix, v.number, v.party_name, s.qty_milli, vl.rate_paise, s.batch_no
          from stock_ledger s
          left join vouchers v on v.id = s.voucher_id
          left join voucher_lines vl on vl.id = s.line_id
          where s.item_id = ${itemId} and s.date between ${from} and ${to}
          order by s.date, s.source desc, s.id`,
    ),
    ["qty_milli", "rate_paise"],
  );
  let running = opening.q;
  for (const e of entries) {
    running += e.qty_milli;
    e.balance_milli = running;
  }
  return { openingMilli: opening.q, entries, closingMilli: running };
}

/** Current stock of one item, broken down by shop/warehouse. Only every active location, even ones with zero of this item. */
export async function stockByLocation(db: DB, firmId: number, itemId: number) {
  const list = nums(
    await rows<{ id: number; name: string; kind: "warehouse" | "shop" | "transit" | "damaged"; qty_milli: number }>(
      db,
      sql`select l.id, l.name, l.kind,
            coalesce((select sum(s.qty_milli) from stock_ledger s where s.item_id = ${itemId} and s.location_id = l.id), 0) as qty_milli
          from locations l
          where l.firm_id = ${firmId} and l.active
          order by case l.kind when 'warehouse' then 0 when 'shop' then 1 when 'transit' then 2 else 3 end, l.sort, l.id`,
    ),
    ["qty_milli"],
  );
  return list;
}

/** In-transit value right now, shortages/damages by receiving shop for a period, and supplier returns by reason. */
export async function transfersReport(db: DB, firmId: number, from: string, to: string) {
  const [inTransit] = nums(
    await rows<{ qty_milli: number; value_paise: number }>(
      db,
      sql`select coalesce(sum(s.qty_milli), 0) as qty_milli, coalesce(sum(round(s.qty_milli * ${costPerUnit} / 1000.0)), 0) as value_paise
          from stock_ledger s
          join items i on i.id = s.item_id
          left join tax_rates t on t.id = i.tax_rate_id
          join locations l on l.id = s.location_id
          where l.firm_id = ${firmId} and l.kind = 'transit'`,
    ),
    ["qty_milli", "value_paise"],
  );
  const byShop = nums(
    await rows<{ location_id: number; location_name: string; transfers: number; damaged_value_paise: number; short_value_paise: number }>(
      db,
      sql`select v.to_location_id as location_id, l.name as location_name,
            count(distinct v.id) as transfers,
            -- Losses count at what the goods cost (transfers themselves go at the sale rate); a line with no item, at its own value.
            coalesce(round(sum(coalesce(vl.damaged_qty_milli, 0) * ${lineUnitCost})), 0) as damaged_value_paise,
            coalesce(round(sum(greatest(vl.qty_milli - coalesce(vl.received_qty_milli, 0) - coalesce(vl.damaged_qty_milli, 0), 0) * ${lineUnitCost})), 0) as short_value_paise
          from vouchers v
          join voucher_lines vl on vl.voucher_id = v.id
          left join items i on i.id = vl.item_id
          left join tax_rates t on t.id = i.tax_rate_id
          join locations l on l.id = v.to_location_id
          where v.firm_id = ${firmId} and v.type = 'stock_transfer' and v.status = 'active' and v.received_at is not null
            and (v.received_at at time zone ${region().timezone})::date between ${from} and ${to}
          group by v.to_location_id, l.name, l.sort
          having sum(coalesce(vl.damaged_qty_milli, 0)) > 0 or sum(greatest(vl.qty_milli - coalesce(vl.received_qty_milli, 0) - coalesce(vl.damaged_qty_milli, 0), 0)) > 0
          order by l.sort`,
    ),
    ["transfers", "damaged_value_paise", "short_value_paise"],
  );
  const byReason = nums(
    await rows<{ reason: string; count: number; value_paise: number }>(
      db,
      sql`select coalesce(v.return_reason, 'not_specified') as reason, count(*) as count, coalesce(sum(v.taxable_paise), 0) as value_paise
          from vouchers v
          where v.firm_id = ${firmId} and v.type = 'debit_note' and v.status = 'active' and v.date between ${from} and ${to}
          group by coalesce(v.return_reason, 'not_specified')
          order by value_paise desc`,
    ),
    ["count", "value_paise"],
  );
  return { inTransit, byShop, byReason };
}

// ─── Cash & bank ─────────────────────────────────────────────────────────────

export async function accountStatement(db: DB, firmId: number, accountId: number, from: string, to: string) {
  await assertOwned(db, "accounts", accountId, firmId);
  const [opening] = nums(
    await rows<{ b: number }>(db, sql`select coalesce(sum(amount_paise), 0) as b from money_ledger where account_id = ${accountId} and date < ${from}`),
    ["b"],
  );
  const entries = nums(
    await rows<{ date: string; voucher_id: number | null; type: VoucherType | null; prefix: string | null; number: number | null; party_name: string | null; memo: string | null; in_paise: number; out_paise: number; balance_paise: number; payment_mode: string | null }>(
      db,
      sql`select m.date::text, m.voucher_id, v.type, v.prefix, v.number, v.party_name, coalesce(m.memo, v.notes) as memo, v.payment_mode,
            case when m.amount_paise > 0 then m.amount_paise else 0 end as in_paise,
            case when m.amount_paise < 0 then -m.amount_paise else 0 end as out_paise
          from money_ledger m left join vouchers v on v.id = m.voucher_id
          where m.account_id = ${accountId} and m.date between ${from} and ${to}
          order by m.date, m.source desc, m.id`,
    ),
    ["in_paise", "out_paise"],
  );
  let running = opening.b;
  for (const e of entries) {
    running += e.in_paise - e.out_paise;
    e.balance_paise = running;
  }
  return { openingPaise: opening.b, entries, closingPaise: running };
}

// ─── Day book ────────────────────────────────────────────────────────────────

export async function dayBook(db: DB, firmId: number, from: string, to: string, access?: { locationIds: number[]; createdBy: number }, opts: { hideSalaries?: boolean; hidePartners?: boolean } = {}) {
  const where: SQL[] = [sql`v.firm_id = ${firmId}`, sql`v.status <> 'deleted'`, sql`v.date between ${from} and ${to}`];
  if (opts.hideSalaries) where.push(sql`v.employee_id is null`);
  if (opts.hidePartners) where.push(sql`v.partner_id is null`);
  const locWhere = locationAccessWhere(access?.locationIds, access?.createdBy);
  if (locWhere) where.push(locWhere);
  const list = nums(
    await rows<{ id: number; type: VoucherType; prefix: string; number: number; date: string; party_name: string | null; total_paise: number; money_in: number; money_out: number; status: string; created_by: string | null }>(
      db,
      sql`select v.id, v.type, v.prefix, v.number, v.date::text, v.party_name, v.total_paise, v.status, u.name as created_by,
            coalesce((select sum(amount_paise) from money_ledger m where m.voucher_id = v.id and m.amount_paise > 0), 0) as money_in,
            coalesce((select -sum(amount_paise) from money_ledger m where m.voucher_id = v.id and m.amount_paise < 0), 0) as money_out
          from vouchers v left join users u on u.id = v.created_by
          where ${sql.join(where, sql` and `)}
          order by v.date, v.created_at`,
    ),
    ["total_paise", "money_in", "money_out"],
  );
  return list;
}

// ─── Profit & loss ───────────────────────────────────────────────────────────

/** Stock value at the end of `date` (all movements on that day included) — used for "closing stock". */
export async function stockValueAt(db: DB, firmId: number, date: string): Promise<number> {
  const list = await stockSummary(db, firmId, { asOf: date, includeInactive: true });
  return list.reduce((s, r) => s + r.stock_value_paise, 0);
}

/**
 * Stock value at the very start of `date` — used for "opening stock" of a trading-account
 * period. Movements dated before `date` count in full; an "opening balance" entry (the
 * quantity a business already held when it started using this app) is dated on the same day
 * as the financial year's start and represents the position *before* that day's business, so
 * it counts too, but a normal voucher (sale/purchase/adjustment) dated on `date` itself hasn't
 * happened yet at the start of the day and is excluded. Without this distinction, a financial
 * year's opening stock would wrongly read as zero whenever items were onboarded with opening
 * quantities dated to the FY start (the common case), understating opening stock and
 * overstating cost of goods sold for the year by the same amount.
 */
async function stockValueAtStartOf(db: DB, firmId: number, date: string): Promise<number> {
  const [row] = nums(
    await rows<{ value: number }>(
      db,
      sql`select coalesce(sum(coalesce(bal.qty_milli, 0) * ${costPerUnit} / 1000), 0) as value
          from items i
          left join units u on u.id = i.unit_id
          left join tax_rates t on t.id = i.tax_rate_id
          left join lateral (
            select sum(s.qty_milli) as qty_milli
            from stock_ledger s
            where s.item_id = i.id and (s.date < ${date} or (s.date = ${date} and s.source = 'opening'))
          ) bal on true
          where i.firm_id = ${firmId} and i.kind = 'goods' and coalesce(bal.qty_milli, 0) > 0`,
    ),
    ["value"],
  );
  return row.value;
}

export async function profitAndLoss(db: DB, firmId: number, from: string, to: string) {
  const [t] = nums(
    await rows<{ sales: number; sale_returns: number; purchases: number; purchase_returns: number; other_income: number; expenses: number; discount_given: number }>(
      db,
      sql`select
            coalesce(sum(taxable_paise) filter (where type = 'sale_invoice'), 0) as sales,
            coalesce(sum(taxable_paise) filter (where type = 'credit_note'), 0) as sale_returns,
            coalesce(sum(taxable_paise) filter (where type = 'purchase_bill'), 0) as purchases,
            coalesce(sum(taxable_paise) filter (where type = 'debit_note'), 0) as purchase_returns,
            coalesce(sum(taxable_paise) filter (where type = 'other_income'), 0) as other_income,
            coalesce(sum(taxable_paise) filter (where type = 'expense'), 0) as expenses,
            coalesce(sum(discount_paise) filter (where type = 'sale_invoice'), 0) as discount_given
          from vouchers where firm_id = ${firmId} and status = 'active' and date between ${from} and ${to}`,
    ),
    ["sales", "sale_returns", "purchases", "purchase_returns", "other_income", "expenses", "discount_given"],
  );
  const expenseByCategory = nums(
    await rows<{ name: string; amount: number }>(
      db,
      sql`select coalesce(c.name, 'Uncategorised') as name, sum(v.taxable_paise) as amount
          from vouchers v left join ledger_categories c on c.id = v.category_id
          where v.firm_id = ${firmId} and v.type = 'expense' and v.status = 'active' and v.date between ${from} and ${to}
          group by 1 order by 2 desc`,
    ),
    ["amount"],
  );
  const incomeByCategory = nums(
    await rows<{ name: string; amount: number }>(
      db,
      sql`select coalesce(c.name, 'Uncategorised') as name, sum(v.taxable_paise) as amount
          from vouchers v left join ledger_categories c on c.id = v.category_id
          where v.firm_id = ${firmId} and v.type = 'other_income' and v.status = 'active' and v.date between ${from} and ${to}
          group by 1 order by 2 desc`,
    ),
    ["amount"],
  );
  const openingStock = await stockValueAtStartOf(db, firmId, from);
  const closingStock = await stockValueAt(db, firmId, to);
  const depreciation = await depreciationBetween(db, firmId, from, to);
  const netSales = t.sales - t.sale_returns;
  const netPurchases = t.purchases - t.purchase_returns;
  const costOfGoodsSold = openingStock + netPurchases - closingStock;
  const grossProfit = netSales - costOfGoodsSold;
  const netProfit = grossProfit + t.other_income - t.expenses - depreciation;
  return {
    sales: t.sales,
    saleReturns: t.sale_returns,
    netSales,
    purchases: t.purchases,
    purchaseReturns: t.purchase_returns,
    netPurchases,
    openingStock,
    closingStock,
    costOfGoodsSold,
    grossProfit,
    otherIncome: t.other_income,
    incomeByCategory,
    expenses: t.expenses,
    expenseByCategory,
    depreciation,
    netProfit,
  };
}

// ─── Item-wise sales ─────────────────────────────────────────────────────────

export async function itemSales(db: DB, firmId: number, from: string, to: string, side: "sale" | "purchase" = "sale") {
  const [fwd, ret] = side === "sale" ? ["sale_invoice", "credit_note"] : ["purchase_bill", "debit_note"];
  return nums(
    await rows<{ item_id: number | null; code: string | null; name: string; qty_milli: number; taxable_paise: number; total_paise: number; unit_code: string | null }>(
      db,
      sql`select l.item_id, max(i.code) as code, coalesce(i.name, l.description) as name, max(l.unit_code) as unit_code,
            sum(case when v.type = ${fwd} then l.qty_milli * l.unit_factor_milli / 1000 else -l.qty_milli * l.unit_factor_milli / 1000 end) as qty_milli,
            sum(case when v.type = ${fwd} then l.taxable_paise else -l.taxable_paise end) as taxable_paise,
            sum(case when v.type = ${fwd} then l.total_paise else -l.total_paise end) as total_paise
          from voucher_lines l join vouchers v on v.id = l.voucher_id left join items i on i.id = l.item_id
          where v.firm_id = ${firmId} and v.status = 'active' and v.type in (${fwd}, ${ret}) and v.date between ${from} and ${to}
          group by l.item_id, coalesce(i.name, l.description)
          order by taxable_paise desc`,
    ),
    ["qty_milli", "taxable_paise", "total_paise"],
  );
}

// ─── Tax report ──────────────────────────────────────────────────────────────

export interface TaxRow {
  gst_bp: number;
  cess_bp: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
}

/** GST collected (sales, less sale returns) or paid (purchases, less purchase returns), by rate. */
export async function taxReport(db: DB, firmId: number, from: string, to: string, side: "outward" | "inward" = "outward") {
  const [fwd, ret] = side === "outward" ? ["sale_invoice", "credit_note"] : ["purchase_bill", "debit_note"];
  // Expenses whose tax can be claimed back count as tax paid, alongside purchase bills.
  const extra = side === "inward" ? sql`or (v.type = 'expense' and v.itc_eligible)` : sql``;
  const rows_ = nums(
    await rows<TaxRow>(
      db,
      sql`select l.gst_bp, l.cess_bp,
            sum(case when v.type = ${fwd} or v.type = 'expense' then l.taxable_paise else -l.taxable_paise end) as taxable_paise,
            sum(case when v.type = ${fwd} or v.type = 'expense' then l.cgst_paise else -l.cgst_paise end) as cgst_paise,
            sum(case when v.type = ${fwd} or v.type = 'expense' then l.sgst_paise else -l.sgst_paise end) as sgst_paise,
            sum(case when v.type = ${fwd} or v.type = 'expense' then l.igst_paise else -l.igst_paise end) as igst_paise,
            sum(case when v.type = ${fwd} or v.type = 'expense' then l.cess_paise else -l.cess_paise end) as cess_paise
          from voucher_lines l join vouchers v on v.id = l.voucher_id
          where v.firm_id = ${firmId} and v.status = 'active' and (v.type in (${fwd}, ${ret}) ${extra}) and v.date between ${from} and ${to} and l.gst_bp > 0
          group by l.gst_bp, l.cess_bp
          order by l.gst_bp, l.cess_bp`,
    ),
    ["taxable_paise", "cgst_paise", "sgst_paise", "igst_paise", "cess_paise"],
  );
  return rows_;
}

// ─── Global search ───────────────────────────────────────────────────────────

export async function globalSearch(db: DB, firmId: number, q: string, opts: { partyContact?: boolean; access?: { locationIds: number[]; createdBy: number }; hideSalaries?: boolean; hidePartners?: boolean } = {}) {
  const contact = opts.partyContact ?? true;
  const term = q.trim().toLowerCase();
  if (term.length < 2) return { parties: [], items: [], vouchers: [] };
  const like = `%${term}%`;
  const voucherWhere: SQL[] = [
    sql`firm_id = ${firmId}`,
    sql`status <> 'deleted'`,
    sql`(lower(prefix || number::text) like ${like} or lower(coalesce(party_name,'')) like ${like} or lower(coalesce(supplier_invoice_no,'')) like ${like})`,
  ];
  const locWhere = opts.access ? locationAccessWhere(opts.access.locationIds, opts.access.createdBy) : null;
  if (locWhere) voucherWhere.push(locWhere);
  if (opts.hideSalaries) voucherWhere.push(sql`v.employee_id is null`);
  if (opts.hidePartners) voucherWhere.push(sql`v.partner_id is null`);
  const [p, i, v] = await Promise.all([
    rows<{ id: number; name: string; phone: string | null }>(
      db,
      contact
        ? sql`select id, name, phone from parties where firm_id = ${firmId} and (lower(name) like ${like} or coalesce(phone,'') like ${like} or lower(coalesce(gstin,'')) like ${like}) order by lower(name) limit 8`
        : sql`select id, name, null::text as phone from parties where firm_id = ${firmId} and lower(name) like ${like} order by lower(name) limit 8`,
    ),
    rows<{ id: number; name: string; code: string | null }>(db, sql`select id, name, code from items where firm_id = ${firmId} and (lower(name) like ${like} or lower(coalesce(code,'')) like ${like}) order by lower(name) limit 8`),
    rows<{ id: number; type: VoucherType; prefix: string; number: number; date: string; party_name: string | null; total_paise: number }>(
      db,
      sql`select id, type, prefix, number, date::text, party_name, total_paise from vouchers v where ${sql.join(voucherWhere, sql` and `)} order by date desc limit 10`,
    ),
  ]);
  return { parties: p, items: i, vouchers: nums(v, ["total_paise"]) };
}

// ─── Daily sales, per shop ────────────────────────────────────────────────────

export interface DailySalesReport {
  date: string;
  locationId: number | null;
  locationName: string | null;
  bills: number;
  grossSalesPaise: number;
  discountPaise: number;
  taxPaise: number;
  returnCount: number;
  returnsPaise: number;
  netSalesPaise: number;
  paidOnBillPaise: number;
  paymentsReceivedPaise: number;
  unpaidPaise: number;
  byPaymentMode: { mode: string; amountPaise: number }[];
  topItems: { itemId: number | null; code: string | null; name: string; qtyMilli: number; unitCode: string | null; amountPaise: number }[];
  byStaff: { userId: number | null; name: string; bills: number; salesPaise: number; returnsPaise: number }[];
}

/** One shop's (or, with no locationId, the whole company's) sales for one day — the "daily sales" report and print-out. */
export async function dailySalesReport(db: DB, firmId: number, date: string, locationId?: number): Promise<DailySalesReport> {
  const locWhere = locationId ? sql`and v.location_id = ${locationId}` : sql``;
  const [totals] = nums(
    await rows<{ bills: number; gross: number; discount: number; tax: number; paid_on_bill: number; unpaid: number }>(
      db,
      sql`select count(*)::int as bills,
            coalesce(sum(v.total_paise), 0) as gross,
            coalesce(sum(v.discount_paise + v.bill_discount_paise), 0) as discount,
            coalesce(sum(v.cgst_paise + v.sgst_paise + v.igst_paise + v.cess_paise), 0) as tax,
            coalesce(sum(v.paid_paise), 0) as paid_on_bill,
            coalesce(sum(${balanceExpr}), 0) as unpaid
          from vouchers v
          where v.firm_id = ${firmId} and v.type = 'sale_invoice' and v.status = 'active' and v.date = ${date} ${locWhere}`,
    ),
    ["bills", "gross", "discount", "tax", "paid_on_bill", "unpaid"],
  );
  const [returns] = nums(
    await rows<{ n: number; amount: number }>(
      db,
      sql`select count(*)::int as n, coalesce(sum(v.total_paise), 0) as amount
          from vouchers v
          where v.firm_id = ${firmId} and v.type = 'credit_note' and v.status = 'active' and v.date = ${date} ${locWhere}`,
    ),
    ["n", "amount"],
  );
  const [paymentsIn] = nums(
    await rows<{ amount: number }>(
      db,
      sql`select coalesce(sum(v.total_paise), 0) as amount
          from vouchers v
          where v.firm_id = ${firmId} and v.type = 'payment_in' and v.status = 'active' and v.date = ${date} ${locWhere}`,
    ),
    ["amount"],
  );
  const byPaymentMode = nums(
    await rows<{ mode: string; amount: number }>(
      db,
      sql`select coalesce(nullif(v.payment_mode, ''), 'Cash') as mode, sum(amt) as amount from (
            select payment_mode, paid_paise as amt, location_id, firm_id, date, status, type from vouchers where type = 'sale_invoice' and paid_paise > 0
            union all
            select payment_mode, total_paise as amt, location_id, firm_id, date, status, type from vouchers where type = 'payment_in'
          ) v
          where v.firm_id = ${firmId} and v.status = 'active' and v.date = ${date} ${locWhere}
          group by 1 order by amount desc`,
    ),
    ["amount"],
  );
  const topItems = nums(
    await rows<{ item_id: number | null; code: string | null; name: string; qty_milli: number; unit_code: string | null; amount: number }>(
      db,
      sql`select l.item_id, max(i.code) as code, coalesce(i.name, l.description) as name, sum(l.qty_milli * l.unit_factor_milli / 1000) as qty_milli, max(u.code) as unit_code, sum(l.total_paise) as amount
          from voucher_lines l
          join vouchers v on v.id = l.voucher_id
          left join items i on i.id = l.item_id
          left join units u on u.id = i.unit_id
          where v.firm_id = ${firmId} and v.type = 'sale_invoice' and v.status = 'active' and v.date = ${date} ${locWhere}
          group by l.item_id, coalesce(i.name, l.description)
          order by amount desc limit 10`,
    ),
    ["qty_milli", "amount"],
  );
  const byStaff = nums(
    await rows<{ user_id: number | null; name: string; bills: number; sales: number; returns: number }>(
      db,
      sql`select v.created_by as user_id, coalesce(u.name, 'Unknown') as name,
            count(*) filter (where v.type = 'sale_invoice')::int as bills,
            coalesce(sum(v.total_paise) filter (where v.type = 'sale_invoice'), 0) as sales,
            coalesce(sum(v.total_paise) filter (where v.type = 'credit_note'), 0) as returns
          from vouchers v
          left join users u on u.id = v.created_by
          where v.firm_id = ${firmId} and v.type in ('sale_invoice', 'credit_note') and v.status = 'active' and v.date = ${date} ${locWhere}
          group by v.created_by, u.name
          order by sales desc`,
    ),
    ["bills", "sales", "returns"],
  );
  const [loc] = locationId ? await rows<{ name: string }>(db, sql`select name from locations where id = ${locationId} and firm_id = ${firmId}`) : [];
  return {
    date,
    locationId: locationId ?? null,
    locationName: loc?.name ?? null,
    bills: totals?.bills ?? 0,
    grossSalesPaise: totals?.gross ?? 0,
    discountPaise: totals?.discount ?? 0,
    taxPaise: totals?.tax ?? 0,
    returnCount: returns?.n ?? 0,
    returnsPaise: returns?.amount ?? 0,
    netSalesPaise: (totals?.gross ?? 0) - (returns?.amount ?? 0),
    paidOnBillPaise: totals?.paid_on_bill ?? 0,
    paymentsReceivedPaise: paymentsIn?.amount ?? 0,
    unpaidPaise: totals?.unpaid ?? 0,
    byPaymentMode: byPaymentMode.map((r) => ({ mode: r.mode, amountPaise: r.amount })),
    topItems: topItems.map((r) => ({ itemId: r.item_id, code: r.code, name: r.name, qtyMilli: r.qty_milli, unitCode: r.unit_code, amountPaise: r.amount })),
    byStaff: byStaff.map((r) => ({ userId: r.user_id, name: r.name, bills: r.bills, salesPaise: r.sales, returnsPaise: r.returns })),
  };
}

export interface StaffSalesRow {
  userId: number | null;
  name: string;
  bills: number;
  returnCount: number;
  salesPaise: number;
  returnsPaise: number;
  netPaise: number;
}

/** Sales and returns per staff member over a date range, optionally at one shop. */
export async function staffSales(db: DB, firmId: number, from: string, to: string, locationId?: number): Promise<StaffSalesRow[]> {
  const locWhere = locationId ? sql`and v.location_id = ${locationId}` : sql``;
  const list = nums(
    await rows<{ user_id: number | null; name: string; bills: number; return_count: number; sales: number; returns: number }>(
      db,
      sql`select v.created_by as user_id, coalesce(u.name, 'Unknown') as name,
            count(*) filter (where v.type = 'sale_invoice')::int as bills,
            count(*) filter (where v.type = 'credit_note')::int as return_count,
            coalesce(sum(v.total_paise) filter (where v.type = 'sale_invoice'), 0) as sales,
            coalesce(sum(v.total_paise) filter (where v.type = 'credit_note'), 0) as returns
          from vouchers v
          left join users u on u.id = v.created_by
          where v.firm_id = ${firmId} and v.type in ('sale_invoice', 'credit_note') and v.status = 'active' and v.date between ${from} and ${to} ${locWhere}
          group by v.created_by, u.name
          order by sales desc`,
    ),
    ["bills", "return_count", "sales", "returns"],
  );
  return list.map((r) => ({ userId: r.user_id, name: r.name, bills: r.bills, returnCount: r.return_count, salesPaise: r.sales, returnsPaise: r.returns, netPaise: r.sales - r.returns }));
}

// ─── Sales & purchases for one day ───────────────────────────────────────────

export interface DayGroup {
  bills: VoucherRow[];
  /** Counted over bills that aren't cancelled. */
  count: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
}

/**
 * Every sale, sale return, purchase and purchase return dated `date`, with totals: the printable
 * "Sales & purchases for the day" report. `scope` limits it to some shops the same way the bill
 * lists are limited (a shop-bound user sees only their shops; an owner can pick one or see all).
 */
export async function daySalesPurchases(
  db: DB,
  firmId: number,
  date: string,
  scope: { locationIds?: number[]; createdBy?: number },
  opts: { hideSalaries?: boolean; hidePartners?: boolean } = {},
) {
  const list = await listVouchers(db, firmId, { types: ["sale_invoice", "credit_note", "purchase_bill", "debit_note"], from: date, to: date, status: "all", limit: 5000, ...scope, ...opts });
  const group = (type: VoucherType): DayGroup => {
    const bills = list.filter((r) => r.type === type).sort((a, b) => a.number - b.number || a.id - b.id);
    const live = bills.filter((r) => r.status === "active");
    const totalPaise = live.reduce((s, r) => s + r.total_paise, 0);
    const duePaise = live.reduce((s, r) => s + Math.max(0, r.balance_paise), 0);
    return { bills, count: live.length, totalPaise, paidPaise: totalPaise - duePaise, duePaise };
  };
  const sales = group("sale_invoice");
  const saleReturns = group("credit_note");
  const purchases = group("purchase_bill");
  const purchaseReturns = group("debit_note");
  return {
    date,
    sales,
    saleReturns,
    purchases,
    purchaseReturns,
    netSalesPaise: sales.totalPaise - saleReturns.totalPaise,
    netPurchasesPaise: purchases.totalPaise - purchaseReturns.totalPaise,
  };
}
