import type { ReadBill } from "./read-bill";

/*
 * Cross-checking what the AI read off a purchase bill. A printed line carries redundant numbers: amount = qty × rate,
 * rate = MRP less discount, and the amounts add up to a printed subtotal. When one number was misread (a discount %
 * taken for the rate, a dropped digit, a wrong quantity) the others usually still agree, so the odd one out can be
 * fixed in code instead of failing the whole bill. Every change is reported so the owner sees it before tapping Enter.
 * Plain code, no AI: unit-tested with the errors seen on a real bill.
 */

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.006);
const rs = (n: number) => n.toFixed(2);
const short = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);

/** A quantity that is a whole number, or a clean half/quarter; null when `n` isn't one. */
function cleanQty(n: number): number | null {
  const q = Math.round(n * 4) / 4;
  return q >= 0.25 && Math.abs(n - q) < 0.01 ? q : null;
}

export interface Reconciled {
  read: ReadBill;
  notes: string[];
}

/**
 * Returns the bill with each line's `rate` as the per-unit price actually charged before tax (the discount, where it
 * applied, is folded in and `discountPct` set to 0), quantities and rates corrected where the printed numbers prove
 * them wrong, and notes describing every correction or doubt.
 */
export function reconcile(read: ReadBill): Reconciled {
  const notes: string[] = [];
  if (read.type !== "purchase_bill" || read.lines.length === 0) return { read, notes };
  const lines = read.lines.map((l) => ({ ...l }));

  // Are the printed line amounts before tax (usual) or after? Whichever makes more lines agree with their rate.
  const withAmount = lines.filter((l) => l.amount != null && l.amount > 0 && l.qty > 0);
  const agree = (inclusive: boolean) =>
    withAmount.filter((l) => {
      const u = (inclusive ? l.amount! / (1 + (l.gstPct ?? 0) / 100) : l.amount!) / l.qty;
      return close(u, l.rate) || close(u, l.rate * (1 - l.discountPct / 100));
    }).length;
  const inclusive = agree(true) > agree(false);

  lines.forEach((l, i) => {
    const label = `Line ${i + 1} (${short(l.description)})`;
    const d = l.discountPct / 100;
    const printedRate = l.rate;
    const afterDiscount = d > 0 ? l.rate * (1 - d) : l.rate;
    const a = l.amount != null && l.amount > 0 ? (inclusive ? l.amount / (1 + (l.gstPct ?? 0) / 100) : l.amount) : null;
    const fromAmount = a != null && l.qty > 0 ? a / l.qty : null;
    const fromMrp = l.mrp != null && l.mrp > 0 && d > 0 ? l.mrp * (1 - d) : null;
    let net = afterDiscount;

    if (fromAmount == null) {
      // No printed amount to check against: MRP tells whether the rate already has the discount in it.
      if (fromMrp != null && close(printedRate, fromMrp)) net = printedRate;
    } else if (close(fromAmount, printedRate)) {
      net = printedRate; // the printed rate is already the price charged
    } else if (d > 0 && close(fromAmount, afterDiscount)) {
      net = afterDiscount; // the printed rate is the list price; the discount applies
    } else {
      // The line doesn't add up: find which number is wrong.
      if (fromMrp != null && close(fromAmount, fromMrp)) {
        net = fromAmount;
        notes.push(`${label}: rate read as ₹${rs(printedRate)}, but the printed amount ₹${rs(l.amount!)} for ${l.qty} and the MRP less discount both give ₹${rs(net)}, so I used that.`);
      } else {
        const qtyFromRate = [printedRate, afterDiscount, ...(fromMrp != null ? [fromMrp] : [])].map((r) => ({ r, q: r > 0 ? cleanQty(a! / r) : null })).find((x) => x.q != null && x.q !== l.qty && (fromMrp == null || close(x.r, fromMrp)));
        if (qtyFromRate) {
          notes.push(`${label}: quantity read as ${l.qty}, but the printed amount ₹${rs(l.amount!)} at ₹${rs(qtyFromRate.r)} each means ${qtyFromRate.q}, so I used that.`);
          net = qtyFromRate.r;
          l.qty = qtyFromRate.q!;
        } else if (fromMrp != null && close(printedRate, fromMrp)) {
          net = printedRate;
          notes.push(`${label}: the printed amount ₹${rs(l.amount!)} doesn't match ${l.qty} × ₹${rs(printedRate)}; the rate agrees with the MRP, so I kept the rate. Check the quantity.`);
        } else {
          net = fromAmount;
          notes.push(`${label}: rate read as ₹${rs(printedRate)}, but the printed amount ₹${rs(l.amount!)} for ${l.qty} gives ₹${rs(net)}, so I used that. Check it.`);
        }
      }
    }
    l.rate = Math.round(net * 100) / 100;
    l.discountPct = 0;
  });

  // The bill's own totals: do the lines add up to them?
  if (read.subtotal != null && read.subtotal > 0) {
    const sum = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const compare = inclusive ? lines.reduce((s, l) => s + (l.qty * l.rate) * (1 + (l.gstPct ?? 0) / 100), 0) : sum;
    if (!close(compare, read.subtotal)) notes.push(`The lines add up to ₹${rs(compare)} but the bill's own subtotal is ₹${rs(read.subtotal)}. A line may be misread or missing.`);
  }
  if (read.totalQty != null && read.totalQty > 0) {
    const q = lines.reduce((s, l) => s + l.qty, 0);
    if (Math.abs(q - read.totalQty) > 0.001) notes.push(`The quantities add up to ${q} but the bill says ${read.totalQty} in total.`);
  }
  return { read: { ...read, lines }, notes };
}
