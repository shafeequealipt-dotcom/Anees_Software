import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import type { VoucherType } from "@/db/schema";
import { nums, rows } from "@/db/query";
import { addDays, monthRange, todayIST } from "@/lib/dates";
import { depreciationBetween } from "./gl";

const settleable = sql`v.type in ('sale_invoice','purchase_bill','credit_note','debit_note','expense','other_income')`;

/** SQL expression: unpaid balance of voucher alias v. */
const balanceExpr = sql`case when ${settleable} and v.party_id is not null and v.status = 'active'
  then v.total_paise - v.paid_paise - coalesce((select sum(a.amount_paise) from allocations a where a.to_voucher_id = v.id), 0)
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
}

export async function listVouchers(
  db: DB,
  firmId: number,
  f: { types: VoucherType[]; from?: string; to?: string; partyId?: number; q?: string; status?: "open" | "paid" | "overdue" | "cancelled" | "all"; limit?: number; accountId?: number; categoryId?: number },
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

  const list = await rows<VoucherRow>(
    db,
    sql`select v.id, v.type, v.prefix, v.number, v.date::text, v.due_date::text, v.status, v.party_id, v.party_name,
          v.total_paise, v.paid_paise, v.taxable_paise, (v.cgst_paise + v.sgst_paise + v.igst_paise + v.cess_paise) as tax_paise,
          ${balanceExpr} as balance_paise, v.payment_mode, a.name as account_name, c.name as category_name,
          (exists(select 1 from vouchers x where x.source_voucher_id = v.id and x.status = 'active')
            or exists(select 1 from voucher_sources vs join vouchers x on x.id = vs.voucher_id where vs.source_id = v.id and x.status = 'active')) as converted,
          v.supplier_invoice_no
        from vouchers v
        left join accounts a on a.id = v.account_id
        left join ledger_categories c on c.id = v.category_id
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

export async function dashboard(db: DB, firmId: number) {
  const today = todayIST();
  const month = monthRange(today);
  const yearAgo = addDays(month.from, -335).slice(0, 8) + "01";

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
          from vouchers where firm_id = ${firmId} and status = 'active' and date between ${month.from} and ${month.to}`,
    ),
    ["sales", "purchases", "expenses", "received", "paid", "invoices"],
  );
  const salesByMonth = nums(
    await rows<{ month: string; sales: number; purchases: number }>(
      db,
      sql`select to_char(date_trunc('month', date), 'YYYY-MM') as month,
            coalesce(sum(case when type = 'sale_invoice' then taxable_paise when type = 'credit_note' then -taxable_paise end), 0) as sales,
            coalesce(sum(case when type = 'purchase_bill' then taxable_paise when type = 'debit_note' then -taxable_paise end), 0) as purchases
          from vouchers where firm_id = ${firmId} and status = 'active' and date >= ${yearAgo}
          group by 1 order by 1`,
    ),
    ["sales", "purchases"],
  );
  const [lowStock] = nums(
    await rows<{ n: number }>(
      db,
      sql`select count(*) as n from (
            select i.id from items i left join stock_ledger s on s.item_id = i.id
            where i.firm_id = ${firmId} and i.active and i.kind = 'goods' and i.min_stock_milli > 0
            group by i.id having coalesce(sum(s.qty_milli), 0) <= i.min_stock_milli) t`,
    ),
    ["n"],
  );
  const overdue = nums(
    await rows<{ id: number; prefix: string; number: number; party_name: string; due_date: string; balance_paise: number }>(
      db,
      sql`select * from (
            select v.id, v.prefix, v.number, v.party_name, v.due_date::text, ${balanceExpr} as balance_paise
            from vouchers v where v.firm_id = ${firmId} and v.type = 'sale_invoice' and v.status = 'active' and v.due_date < ${today}) t
          where balance_paise > 0 order by due_date limit 8`,
    ),
    ["balance_paise"],
  );
  return {
    receivable: Number(balances.receivable),
    payable: Number(balances.payable),
    money,
    month: monthTotals,
    salesByMonth,
    lowStock: lowStock.n,
    overdue,
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
export async function partyStatement(db: DB, partyId: number, from: string, to: string) {
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

/** Stock value uses the purchase price without tax. */
const costPerUnit = sql`case when i.purchase_price_includes_tax
    then round(i.purchase_price_paise * 10000.0 / (10000 + coalesce(t.gst_bp, 0) + coalesce(t.cess_bp, 0)))
    else i.purchase_price_paise end`;

export async function stockSummary(db: DB, firmId: number, f: { asOf?: string; q?: string; categoryId?: number; lowOnly?: boolean; includeInactive?: boolean } = {}) {
  const asOf = f.asOf ?? "9999-12-31";
  const where: SQL[] = [sql`i.firm_id = ${firmId}`, sql`i.kind = 'goods'`];
  if (!f.includeInactive) where.push(sql`i.active`);
  if (f.categoryId) where.push(sql`i.category_id = ${f.categoryId}`);
  if (f.q) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    where.push(sql`(lower(i.name) like ${like} or lower(coalesce(i.code,'')) like ${like})`);
  }
  const list = nums(
    await rows<StockRow>(
      db,
      sql`select i.id, i.name, i.code, c.name as category_name, u.code as unit_code, i.active,
            coalesce((select sum(s.qty_milli) from stock_ledger s where s.item_id = i.id and s.date <= ${asOf}), 0) as qty_milli,
            i.min_stock_milli, i.purchase_price_paise, i.sale_price_paise, ${costPerUnit} as cost_per_unit_paise
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
    r.low = r.min_stock_milli > 0 && r.qty_milli <= r.min_stock_milli;
  }
  return f.lowOnly ? list.filter((r) => r.low) : list;
}

export async function itemMovements(db: DB, itemId: number, from: string, to: string) {
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

// ─── Cash & bank ─────────────────────────────────────────────────────────────

export async function accountStatement(db: DB, accountId: number, from: string, to: string) {
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

export async function dayBook(db: DB, firmId: number, from: string, to: string) {
  const list = nums(
    await rows<{ id: number; type: VoucherType; prefix: string; number: number; date: string; party_name: string | null; total_paise: number; money_in: number; money_out: number; status: string; created_by: string | null }>(
      db,
      sql`select v.id, v.type, v.prefix, v.number, v.date::text, v.party_name, v.total_paise, v.status, u.name as created_by,
            coalesce((select sum(amount_paise) from money_ledger m where m.voucher_id = v.id and m.amount_paise > 0), 0) as money_in,
            coalesce((select -sum(amount_paise) from money_ledger m where m.voucher_id = v.id and m.amount_paise < 0), 0) as money_out
          from vouchers v left join users u on u.id = v.created_by
          where v.firm_id = ${firmId} and v.status <> 'deleted' and v.date between ${from} and ${to}
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
    await rows<{ item_id: number | null; name: string; qty_milli: number; taxable_paise: number; total_paise: number; unit_code: string | null }>(
      db,
      sql`select l.item_id, coalesce(i.name, l.description) as name, max(l.unit_code) as unit_code,
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

export async function globalSearch(db: DB, firmId: number, q: string, opts: { partyContact?: boolean } = {}) {
  const contact = opts.partyContact ?? true;
  const term = q.trim().toLowerCase();
  if (term.length < 2) return { parties: [], items: [], vouchers: [] };
  const like = `%${term}%`;
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
      sql`select id, type, prefix, number, date::text, party_name, total_paise from vouchers
          where firm_id = ${firmId} and status <> 'deleted' and (lower(prefix || number::text) like ${like} or lower(coalesce(party_name,'')) like ${like} or lower(coalesce(supplier_invoice_no,'')) like ${like})
          order by date desc limit 10`,
    ),
  ]);
  return { parties: p, items: i, vouchers: nums(v, ["total_paise"]) };
}
