import type { VoucherType } from "@/db/schema";

/**
 * Turns a voucher into ledger movements. Pure function: no database access,
 * so the rules are easy to test and reason about.
 *
 * Signs
 *   party: + means the party owes us more (receivable up / payable down)
 *   money: + means money came into the account
 *   stock: + means stock came in
 */

export interface PostingVoucher {
  type: VoucherType;
  date: string;
  status: "active" | "cancelled";
  partyId: number | null;
  totalPaise: number;
  paidPaise: number;
  accountId: number | null;
  toAccountId: number | null;
  direction: number | null;
  lines: {
    lineId?: number;
    itemId: number | null;
    isGoods: boolean;
    qtyMilli: number;
    unitFactorMilli: number;
    taxablePaise: number;
    batchNo?: string | null;
    expiryDate?: string | null;
  }[];
}

export interface Postings {
  party: { partyId: number; date: string; amountPaise: number; memo?: string }[];
  money: { accountId: number; date: string; amountPaise: number; memo?: string }[];
  stock: {
    lineId?: number;
    itemId: number;
    date: string;
    qtyMilli: number;
    valuePaise: number;
    batchNo?: string | null;
    expiryDate?: string | null;
  }[];
}

export class PostingError extends Error {}

/** Per-type sign for the bill amount on the party, and for money/stock movements. */
const RULES: Record<VoucherType, { party: number; money: number; stock: number }> = {
  sale_invoice: { party: +1, money: +1, stock: -1 },
  credit_note: { party: -1, money: -1, stock: +1 },
  purchase_bill: { party: -1, money: -1, stock: +1 },
  debit_note: { party: +1, money: +1, stock: -1 },
  payment_in: { party: 0, money: +1, stock: 0 },
  payment_out: { party: 0, money: -1, stock: 0 },
  expense: { party: -1, money: -1, stock: 0 },
  other_income: { party: +1, money: +1, stock: 0 },
  stock_adjustment: { party: 0, money: 0, stock: 0 },
  money_adjustment: { party: 0, money: 0, stock: 0 },
  money_transfer: { party: 0, money: 0, stock: 0 },
  quotation: { party: 0, money: 0, stock: 0 },
  sales_order: { party: 0, money: 0, stock: 0 },
  purchase_order: { party: 0, money: 0, stock: 0 },
  delivery_challan: { party: 0, money: 0, stock: 0 },
};

export function affectsLedgers(type: VoucherType): boolean {
  return !["quotation", "sales_order", "purchase_order", "delivery_challan"].includes(type);
}

export function buildPostings(v: PostingVoucher): Postings {
  const out: Postings = { party: [], money: [], stock: [] };
  if (v.status === "cancelled" || !affectsLedgers(v.type)) return out;
  const date = v.date;

  if (v.type === "money_transfer") {
    if (!v.accountId || !v.toAccountId) throw new PostingError("Choose both accounts for the transfer.");
    if (v.accountId === v.toAccountId) throw new PostingError("Transfer needs two different accounts.");
    out.money.push({ accountId: v.accountId, date, amountPaise: -v.totalPaise });
    out.money.push({ accountId: v.toAccountId, date, amountPaise: v.totalPaise });
    return out;
  }

  if (v.type === "money_adjustment") {
    if (!v.accountId) throw new PostingError("Choose the cash or bank account to adjust.");
    const dir = v.direction === -1 ? -1 : 1;
    out.money.push({ accountId: v.accountId, date, amountPaise: dir * v.totalPaise });
    return out;
  }

  if (v.type === "stock_adjustment") {
    const dir = v.direction === -1 ? -1 : 1;
    for (const l of v.lines) {
      if (!l.itemId || !l.isGoods) continue;
      out.stock.push({
        lineId: l.lineId,
        itemId: l.itemId,
        date,
        qtyMilli: dir * baseQty(l),
        valuePaise: dir * l.taxablePaise,
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
      });
    }
    return out;
  }

  const rule = RULES[v.type];

  if (v.type === "payment_in" || v.type === "payment_out") {
    if (!v.partyId) throw new PostingError("Choose the party for this payment.");
    if (!v.accountId) throw new PostingError("Choose the cash or bank account.");
    // Receiving money reduces what they owe; paying reduces what we owe.
    out.party.push({ partyId: v.partyId, date, amountPaise: -rule.money * v.totalPaise });
    out.money.push({ accountId: v.accountId, date, amountPaise: rule.money * v.totalPaise });
    return out;
  }

  const paid = Math.max(0, Math.min(v.paidPaise, v.totalPaise));
  const unpaid = v.totalPaise - paid;
  if (!v.partyId && unpaid !== 0) {
    throw new PostingError("Without a party, the full amount must be paid now. Choose a party to record a credit bill.");
  }
  if (paid > 0 && !v.accountId) throw new PostingError("Choose where the money went (cash or bank).");

  if (v.partyId) {
    out.party.push({ partyId: v.partyId, date, amountPaise: rule.party * v.totalPaise });
    if (paid > 0) out.party.push({ partyId: v.partyId, date, amountPaise: -rule.party * paid, memo: "Paid on bill" });
  }
  if (paid > 0 && v.accountId) out.money.push({ accountId: v.accountId, date, amountPaise: rule.money * paid });

  if (rule.stock !== 0) {
    for (const l of v.lines) {
      if (!l.itemId || !l.isGoods) continue;
      out.stock.push({
        lineId: l.lineId,
        itemId: l.itemId,
        date,
        qtyMilli: rule.stock * baseQty(l),
        valuePaise: rule.stock * l.taxablePaise,
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
      });
    }
  }
  return out;
}

/** Quantity in the item's base unit. */
export function baseQty(l: { qtyMilli: number; unitFactorMilli: number }): number {
  return Math.round((l.qtyMilli * (l.unitFactorMilli || 1000)) / 1000);
}
