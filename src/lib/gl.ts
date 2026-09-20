/**
 * Double-entry rules, kept free of the database so they can be tested on their own.
 * Every bill is turned into balanced debit/credit lines that mirror what the party and cash/bank ledgers already show.
 */
import type { VoucherType } from "@/db/schema";

export interface GlLine {
  /** Account key: 'receivable', 'sales', 'money:12', 'cat:3' … */
  key: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface VoucherForGl {
  type: VoucherType;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  roundOffPaise: number;
  itcEligible: boolean;
  categoryId: number | null;
  tcsPaise?: number;
  tdsPaise?: number;
}

/** Bills that touch the accounts. Orders, quotations, challans and stock adjustments do not. */
export const GL_TYPES: VoucherType[] = ["sale_invoice", "credit_note", "purchase_bill", "debit_note", "payment_in", "payment_out", "expense", "other_income", "money_transfer", "money_adjustment"];

const SALES_SIDE: VoucherType[] = ["sale_invoice", "credit_note", "payment_in", "other_income"];

function push(lines: GlLine[], key: string, signedDebit: number, memo?: string) {
  if (!signedDebit) return;
  lines.push(signedDebit > 0 ? { key, debit: signedDebit, credit: 0, memo } : { key, debit: 0, credit: -signedDebit, memo });
}

/**
 * @param partyNet net movement on the party's ledger for this bill (positive = they owe us more)
 * @param money    movements on cash/bank accounts (positive = money in)
 */
export function journalForVoucher(v: VoucherForGl, partyNet: number, money: { accountId: number; amountPaise: number }[]): GlLine[] {
  const lines: GlLine[] = [];
  push(lines, SALES_SIDE.includes(v.type) ? "receivable" : "payable", partyNet);
  for (const m of money) push(lines, `money:${m.accountId}`, m.amountPaise);

  const tax = v.cgstPaise + v.sgstPaise + v.igstPaise + v.cessPaise;
  const cat = v.categoryId ? `cat:${v.categoryId}` : null;
  switch (v.type) {
    case "sale_invoice":
      push(lines, "sales", -v.taxablePaise);
      push(lines, "output_tax", -tax);
      push(lines, "round_off", -v.roundOffPaise);
      push(lines, "tcs_payable", -(v.tcsPaise ?? 0));
      push(lines, "tds_receivable", v.tdsPaise ?? 0);
      break;
    case "credit_note":
      push(lines, "sales", v.taxablePaise, "Sale return");
      push(lines, "output_tax", tax);
      push(lines, "round_off", v.roundOffPaise);
      break;
    case "purchase_bill":
      push(lines, "purchases", v.taxablePaise);
      push(lines, "input_tax", tax);
      push(lines, "round_off", v.roundOffPaise);
      push(lines, "tds_payable", -(v.tdsPaise ?? 0));
      break;
    case "debit_note":
      push(lines, "purchases", -v.taxablePaise, "Purchase return");
      push(lines, "input_tax", -tax);
      push(lines, "round_off", -v.roundOffPaise);
      break;
    case "expense":
      push(lines, cat ?? "expense_default", v.taxablePaise + (v.itcEligible ? 0 : tax));
      push(lines, "input_tax", v.itcEligible ? tax : 0);
      push(lines, "round_off", v.roundOffPaise);
      push(lines, "tds_payable", -(v.tdsPaise ?? 0));
      break;
    case "other_income":
      push(lines, cat ?? "other_income", -v.taxablePaise);
      push(lines, "output_tax", -tax);
      push(lines, "round_off", -v.roundOffPaise);
      break;
    case "money_adjustment":
      push(lines, "capital", -(partyNet + money.reduce((s, m) => s + m.amountPaise, 0)));
      break;
    default:
      break;
  }

  // Anything that still doesn't balance (rounding on odd bills) goes to Round off, so the books always balance.
  const diff = lines.reduce((s, l) => s + l.debit - l.credit, 0);
  if (diff !== 0) push(lines, "round_off", -diff, "Rounding");
  return lines;
}

export const isBalanced = (lines: { debit: number; credit: number }[]) => lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0;

/** Opening balances: the other side of every opening figure is Opening balance equity. */
export function openingJournal(kind: "party" | "money" | "stock", amountPaise: number, moneyKey?: string): GlLine[] {
  const lines: GlLine[] = [];
  if (!amountPaise) return lines;
  const key = kind === "party" ? (amountPaise > 0 ? "receivable" : "payable") : kind === "money" ? moneyKey! : "opening_stock";
  push(lines, key, amountPaise);
  push(lines, "obe", -amountPaise);
  return lines;
}

// ─── Depreciation ────────────────────────────────────────────────────────────

export interface AssetForDepreciation {
  costPaise: number;
  salvagePaise: number;
  method: "straight_line" | "reducing";
  rateBp: number;
  purchaseDate: string;
  disposedOn: string | null;
}

const dayNum = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000);

/**
 * Depreciation for one financial year (from..to inclusive).
 * Straight line: (cost - salvage) x rate. Reducing: (cost - depreciation so far) x rate.
 * Part-years (bought or sold during the year) are charged by days. Never goes below the salvage value.
 */
export function depreciationForYear(a: AssetForDepreciation, from: string, to: string, accumulatedPaise: number): number {
  const start = a.purchaseDate > from ? a.purchaseDate : from;
  const end = a.disposedOn && a.disposedOn < to ? a.disposedOn : to;
  if (end < start) return 0;
  const days = dayNum(end) - dayNum(start) + 1;
  const yearDays = dayNum(to) - dayNum(from) + 1;
  const base = a.method === "straight_line" ? a.costPaise - a.salvagePaise : a.costPaise - accumulatedPaise;
  const full = (base * a.rateBp) / 10000;
  const d = Math.round((full * days) / yearDays);
  const room = a.costPaise - a.salvagePaise - accumulatedPaise;
  return Math.max(0, Math.min(d, room));
}
