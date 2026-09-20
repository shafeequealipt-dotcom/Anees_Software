import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import { nums, rows } from "@/db/query";

export interface BillProfitRow {
  id: number;
  type: "sale_invoice" | "credit_note";
  prefix: string;
  number: number;
  date: string;
  party_id: number | null;
  party_name: string | null;
  revenue_paise: number;
  cost_paise: number;
  profit_paise: number;
  margin_bp: number;
}

/**
 * Profit per sale bill: what it sold for (before tax) minus what the goods cost. A sale return counts against profit.
 * Cost is what the stock was valued at when it left, so later price changes don't rewrite old bills.
 */
export async function billProfit(db: DB, firmId: number, f: { from: string; to: string; partyId?: number }): Promise<BillProfitRow[]> {
  const where: SQL[] = [sql`v.firm_id = ${firmId}`, sql`v.status = 'active'`, sql`v.type in ('sale_invoice','credit_note')`, sql`v.date between ${f.from} and ${f.to}`];
  if (f.partyId) where.push(sql`v.party_id = ${f.partyId}`);
  const list = nums(
    await rows<BillProfitRow>(
      db,
      sql`select v.id, v.type, v.prefix, v.number, v.date::text, v.party_id, v.party_name,
            case when v.type = 'sale_invoice' then v.taxable_paise else -v.taxable_paise end as revenue_paise,
            coalesce((select -sum(s.value_paise) from stock_ledger s where s.voucher_id = v.id), 0) as cost_paise
          from vouchers v
          where ${sql.join(where, sql` and `)}
          order by v.date desc, v.id desc`,
    ),
    ["revenue_paise", "cost_paise"],
  );
  for (const r of list) {
    r.profit_paise = r.revenue_paise - r.cost_paise;
    r.margin_bp = r.revenue_paise > 0 ? Math.round((r.profit_paise * 10000) / r.revenue_paise) : 0;
  }
  return list;
}

export interface PartyProfitRow {
  party_id: number | null;
  party_name: string;
  bills: number;
  revenue_paise: number;
  cost_paise: number;
  profit_paise: number;
  margin_bp: number;
}

export function groupByParty(list: BillProfitRow[]): PartyProfitRow[] {
  const map = new Map<string, PartyProfitRow>();
  for (const r of list) {
    const key = r.party_id ? `p${r.party_id}` : "walkin";
    const g = map.get(key) ?? { party_id: r.party_id, party_name: r.party_name || "Cash / walk-in customers", bills: 0, revenue_paise: 0, cost_paise: 0, profit_paise: 0, margin_bp: 0 };
    g.bills += r.type === "sale_invoice" ? 1 : 0;
    g.revenue_paise += r.revenue_paise;
    g.cost_paise += r.cost_paise;
    g.profit_paise += r.profit_paise;
    map.set(key, g);
  }
  const out = [...map.values()];
  for (const g of out) g.margin_bp = g.revenue_paise > 0 ? Math.round((g.profit_paise * 10000) / g.revenue_paise) : 0;
  return out.sort((a, b) => b.profit_paise - a.profit_paise);
}

/** Profit on one bill, for the invoice page. Null for anything that isn't a sale bill. */
export async function voucherProfit(db: DB, firmId: number, voucherId: number) {
  const [r] = nums(
    await rows<{ revenue: number; cost: number; type: string }>(
      db,
      sql`select v.type,
            case when v.type = 'sale_invoice' then v.taxable_paise else -v.taxable_paise end as revenue,
            coalesce((select -sum(s.value_paise) from stock_ledger s where s.voucher_id = v.id), 0) as cost
          from vouchers v where v.id = ${voucherId} and v.firm_id = ${firmId} and v.status = 'active' and v.type in ('sale_invoice','credit_note')`,
    ),
    ["revenue", "cost"],
  );
  if (!r) return null;
  const profit = r.revenue - r.cost;
  return { revenuePaise: r.revenue, costPaise: r.cost, profitPaise: profit, marginBp: r.revenue > 0 ? Math.round((profit * 10000) / r.revenue) : 0 };
}

// ─── Batches and serial numbers ──────────────────────────────────────────────

export interface BatchRow {
  item_id: number;
  item_name: string;
  batch_no: string;
  expiry_date: string | null;
  qty_milli: number;
  unit_code: string | null;
  days_to_expiry: number | null;
}

/** Stock by batch (only items where batches are tracked, plus any stock that carries a batch number). */
export async function batchStock(db: DB, firmId: number, opts: { includeEmpty?: boolean; today: string }): Promise<BatchRow[]> {
  const list = nums(
    await rows<BatchRow>(
      db,
      sql`select i.id as item_id, i.name as item_name, coalesce(s.batch_no, '(no batch)') as batch_no, max(s.expiry_date)::text as expiry_date,
            sum(s.qty_milli) as qty_milli, u.code as unit_code
          from stock_ledger s
          join items i on i.id = s.item_id
          left join units u on u.id = i.unit_id
          where i.firm_id = ${firmId} and (i.track_batches or s.batch_no is not null)
          group by i.id, i.name, coalesce(s.batch_no, '(no batch)'), u.code
          ${opts.includeEmpty ? sql`` : sql`having sum(s.qty_milli) <> 0`}
          order by max(s.expiry_date) nulls last, i.name`,
    ),
    ["qty_milli"],
  );
  const t = Date.parse(opts.today + "T00:00:00Z");
  for (const r of list) r.days_to_expiry = r.expiry_date ? Math.round((Date.parse(r.expiry_date + "T00:00:00Z") - t) / 86_400_000) : null;
  return list;
}

export interface SerialRow {
  item_id: number;
  item_name: string;
  serial: string;
  status: "in_stock" | "sold";
  last_date: string;
  last_ref: string;
  party_name: string | null;
}

/** Every serial number ever recorded, with whether it is still in stock and where it went. */
export async function serialReport(db: DB, firmId: number, opts: { itemId?: number; q?: string } = {}): Promise<SerialRow[]> {
  const lines = await rows<{ item_id: number; item_name: string; serials: string[]; type: string; direction: number | null; date: string; prefix: string; number: number; party_name: string | null }>(
    db,
    sql`select l.item_id, i.name as item_name, l.serial_numbers as serials, v.type, v.direction, v.date::text, v.prefix, v.number, v.party_name
        from voucher_lines l
        join vouchers v on v.id = l.voucher_id
        join items i on i.id = l.item_id
        where v.firm_id = ${firmId} and v.status = 'active' and l.serial_numbers is not null
          ${opts.itemId ? sql`and l.item_id = ${opts.itemId}` : sql``}
        order by v.date, v.id, l.id`,
  );
  const inward = (type: string, direction: number | null) => type === "purchase_bill" || type === "credit_note" || (type === "stock_adjustment" && (direction ?? 1) > 0);
  const outward = (type: string, direction: number | null) => type === "sale_invoice" || type === "debit_note" || (type === "stock_adjustment" && (direction ?? 1) < 0);
  const last = new Map<string, SerialRow>();
  for (const l of lines) {
    const status = inward(l.type, l.direction) ? "in_stock" : outward(l.type, l.direction) ? "sold" : null;
    if (!status) continue;
    for (const serial of l.serials) {
      last.set(`${l.item_id}|${serial}`, { item_id: l.item_id, item_name: l.item_name, serial, status, last_date: l.date, last_ref: `${l.prefix}${l.number}`, party_name: l.party_name });
    }
  }
  let out = [...last.values()];
  if (opts.q) {
    const q = opts.q.toLowerCase();
    out = out.filter((r) => r.serial.toLowerCase().includes(q) || r.item_name.toLowerCase().includes(q));
  }
  return out.sort((a, b) => a.item_name.localeCompare(b.item_name) || a.serial.localeCompare(b.serial));
}
