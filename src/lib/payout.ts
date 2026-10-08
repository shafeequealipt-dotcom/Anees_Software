import { numberToIndianWords } from "./amount-in-words";

/*
 * Partner payout invoices: the sums and wording, kept free of the database so they can be tested
 * on their own. Money is in paise like everywhere else, but a partner's month is worked out in
 * whole rupees, as on the payout invoices Orpheus has always made.
 */

/** One million: the rate is "per 10,00,000 views". */
export const VIEWS_PER_RATE = 1_000_000;

/** What `views` earn at `ratePerMillionPaise`, in paise, rounded to the whole rupee (42,500,000 × ₹400 = ₹17,000). */
export function viewsAmountPaise(views: number, ratePerMillionPaise: number): number {
  if (!(views > 0) || !(ratePerMillionPaise > 0)) return 0;
  return Math.round((views / VIEWS_PER_RATE) * (ratePerMillionPaise / 100)) * 100;
}

/** "42,500,000" — views are read against a YouTube dashboard, so international grouping. */
export const groupViews = (n: number) => Math.round(n).toLocaleString("en-US");

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** 42,500,000 → "42.5M"; 750,000 → "750K"; small counts need no short form (null). */
export function compactViews(n: number): string | null {
  if (n < 1e4) return null;
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (let i = 0; i < units.length; i++) {
    if (n < units[i][0]) continue;
    let s = trimZeros((n / units[i][0]).toFixed(2));
    // Rounding can push 999,999 up to "1000K": say it in the next unit up.
    if (parseFloat(s) >= 1000 && i > 0) {
      i--;
      s = trimZeros((n / units[i][0]).toFixed(2));
    }
    return s + units[i][1];
  }
  return null;
}

/** The Indian financial year a date falls in, April to March: "2026-27". */
export function financialYearLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "ORP/2026-27/004" */
export function payoutInvoiceNo(prefix: string, isoDate: string, seq: number): string {
  return `${prefix || "ORP"}/${financialYearLabel(isoDate)}/${String(seq).padStart(3, "0")}`;
}

/** The running number at the end of an invoice number, if it has one ("ORP/2026-27/004" → 4). */
export function invoiceSequence(invoiceNo: string): number | null {
  const m = /(\d+)\s*$/.exec(invoiceNo);
  return m ? parseInt(m[1], 10) : null;
}

/** The next free number in a series: one past the highest in use, whatever order they were made in. */
export function nextInvoiceSequence(existing: Iterable<string>, prefix: string, isoDate: string): number {
  const stem = `${prefix || "ORP"}/${financialYearLabel(isoDate)}/`.toLowerCase();
  let highest = 0;
  for (const no of existing) {
    if (!no.toLowerCase().startsWith(stem)) continue;
    const n = invoiceSequence(no);
    if (n !== null && n > highest) highest = n;
  }
  return highest + 1;
}

/** "Rupees Thirty Two Thousand Only" */
export const rupeesInWords = (paise: number) => `Rupees ${numberToIndianWords(Math.round(paise / 100))} Only`;

/** "payee@upi · A/c 1234, IFSC ABCD0123456" — where to send the money, from the partner's bank details. */
export function paymentToLine(p: {
  kind: string;
  upiId?: string | null;
  bankHolder?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankBranch?: string | null;
  bankIfsc?: string | null;
  bankSwift?: string | null;
  bankIban?: string | null;
}): string {
  const parts: string[] = [];
  if (p.kind !== "international" && p.upiId) parts.push(p.upiId);
  const bank = [p.bankHolder, p.bankName, p.bankBranch].filter(Boolean).join(", ");
  if (bank) parts.push(bank);
  if (p.bankAccountNo) parts.push(`A/c ${p.bankAccountNo}`);
  if (p.kind === "international") {
    if (p.bankIban) parts.push(`IBAN ${p.bankIban}`);
    if (p.bankSwift) parts.push(`SWIFT ${p.bankSwift}`);
  } else if (p.bankIfsc) parts.push(`IFSC ${p.bankIfsc}`);
  return parts.join(" · ");
}
