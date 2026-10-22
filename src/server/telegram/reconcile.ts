import type { ReadBill } from "./read-bill";

/*
 * Cross-checking what the AI read off a purchase bill. A printed bill carries redundant numbers: amount = qty × rate,
 * rate = MRP less discount, each row's tax = amount × GST %, the amounts add up to a printed subtotal and to a tax
 * summary by rate, and everything adds up to the grand total. When one number was misread (a discount % taken for the
 * rate, a dropped digit, a wrong quantity, a GST rate read as 5% instead of 18%, CGST 9% taken for the whole GST) the
 * others usually still agree, so the odd one out can be fixed in code instead of failing the whole bill. Every change
 * is reported so the owner sees it before tapping Enter. Plain code, no AI: unit-tested with errors seen on real bills.
 */

/** Generous agreement, for deciding which of several readings is the misread one. */
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.006);
/** Tight agreement, for "these two are the same printed price" (allows only a price printed rounded to the paisa). */
const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.006, Math.abs(b) * 0.002);
const rs = (n: number) => n.toFixed(2);
const short = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);
const exact = (n: number) => Math.round(n * 1e6) / 1e6;

/** The GST rates India uses (combined CGST + SGST, or IGST). */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
/** Rates that only ever appear as one half of CGST + SGST. */
const HALF_RATES = new Map([
  [2.5, 5],
  [6, 12],
  [9, 18],
  [14, 28],
  [20, 40],
]);

/** A quantity that is a whole number, or a clean half/quarter; null when `n` isn't one. */
function cleanQty(n: number): number | null {
  const q = Math.round(n * 4) / 4;
  return q >= 0.25 && Math.abs(n - q) < 0.01 ? q : null;
}

/** The GST rate a row's tax implies, when it's clearly one of India's rates. */
function rateFromTax(tax: number, base: number): number | null {
  if (base <= 0) return null;
  const pct = (tax / base) * 100;
  const hit = GST_RATES.find((r) => Math.abs(pct - r) <= Math.max(0.15, r * 0.02));
  return hit ?? null;
}

export interface Reconciled {
  read: ReadBill;
  notes: string[];
}

/**
 * Returns the bill with each line's `rate` as the per-unit price actually charged before tax (the discount, where it
 * applied, folded in and `discountPct` set to 0; kept to the sub-paisa when the bill prices that finely), `amount` as
 * the line's printed amount before tax where it can be trusted (null otherwise), quantities, rates and GST rates
 * corrected where the bill's own numbers prove them wrong, and notes describing every correction or doubt.
 */
export function reconcile(read: ReadBill): Reconciled {
  const notes: string[] = [];
  if (read.type !== "purchase_bill" || read.lines.length === 0) return { read, notes };
  const lines = read.lines.map((l) => ({ ...l }));

  // 1. CGST and SGST shown separately and read as the whole GST (9% instead of 18%).
  const halves = lines.filter((l) => l.gstPct != null && HALF_RATES.has(l.gstPct));
  if (halves.length) {
    const from = [...new Set(halves.map((l) => l.gstPct!))];
    for (const l of halves) l.gstPct = HALF_RATES.get(l.gstPct!)!;
    notes.push(`GST was read as ${from.map((r) => `${r}%`).join(" / ")}, which is only the CGST (or SGST) half; used the full ${from.map((r) => `${HALF_RATES.get(r)}%`).join(" / ")}.`);
  }
  const summary = (read.gstSummary ?? []).map((s) => ({ ...s, ratePct: HALF_RATES.get(s.ratePct) ?? s.ratePct }));

  // 2. A row's "amount" that is really its tax (a VALUE / GST column taken for the AMOUNT).
  for (const l of lines) {
    if (l.amount == null || l.amount <= 0 || !l.gstPct || l.qty <= 0) continue;
    const bases = [l.rate, l.rate * (1 - l.discountPct / 100)].map((r) => r * l.qty);
    const isTax = bases.some((b) => close(l.amount!, (b * l.gstPct!) / 100)) && !bases.some((b) => close(l.amount!, b));
    if (isTax) {
      l.taxAmount = l.taxAmount ?? l.amount;
      l.amount = null;
    }
  }

  // Are the printed line amounts before tax (usual) or after? Whichever makes more lines agree with their rate.
  const withAmount = lines.filter((l) => l.amount != null && l.amount > 0 && l.qty > 0);
  const agree = (inclusive: boolean) =>
    withAmount.filter((l) => {
      const u = (inclusive ? l.amount! / (1 + (l.gstPct ?? 0) / 100) : l.amount!) / l.qty;
      return close(u, l.rate) || close(u, l.rate * (1 - l.discountPct / 100));
    }).length;
  const inclusive = agree(true) > agree(false);

  // 3. Each row: qty × rate against the printed amount, and rate against MRP less discount.
  lines.forEach((l, i) => {
    const label = `Line ${i + 1} (${short(l.description)})`;
    const d = l.discountPct / 100;
    const printedRate = l.rate;
    const afterDiscount = d > 0 ? l.rate * (1 - d) : l.rate;
    const a = l.amount != null && l.amount > 0 ? (inclusive ? l.amount / (1 + (l.gstPct ?? 0) / 100) : l.amount) : null;
    const fromAmount = a != null && l.qty > 0 ? a / l.qty : null;
    const fromMrp = l.mrp != null && l.mrp > 0 && d > 0 ? l.mrp * (1 - d) : null;
    let net = afterDiscount;
    let amountTrusted = false;

    if (fromAmount == null) {
      // No printed amount to check against: MRP tells whether the rate already has the discount in it.
      if (fromMrp != null && close(printedRate, fromMrp)) net = printedRate;
    } else if (same(fromAmount, printedRate) || (d > 0 && same(fromAmount, afterDiscount))) {
      net = fromAmount; // the row adds up; the amount is the exact price charged (finer than the printed rate if need be)
      amountTrusted = true;
    } else if (close(fromAmount, printedRate) || (d > 0 && close(fromAmount, afterDiscount))) {
      net = fromAmount; // a rate printed rounded (more than a paisa off): the amount is what was charged
      amountTrusted = true;
      notes.push(`${label}: rate printed as ₹${rs(printedRate)} but the amount ₹${rs(l.amount!)} for ${l.qty} means ₹${fromAmount.toFixed(4)} each; I used the amount.`);
    } else {
      // The row doesn't add up: find which number is wrong.
      if (fromMrp != null && close(fromAmount, fromMrp)) {
        net = fromAmount;
        amountTrusted = true;
        notes.push(`${label}: rate read as ₹${rs(printedRate)}, but the printed amount ₹${rs(l.amount!)} for ${l.qty} and the MRP less discount both give ₹${rs(net)}, so I used that.`);
      } else {
        const qtyFromRate = [printedRate, afterDiscount, ...(fromMrp != null ? [fromMrp] : [])]
          .map((r) => ({ r, q: r > 0 ? cleanQty(a! / r) : null }))
          .find((x) => x.q != null && x.q !== l.qty && (fromMrp == null || close(x.r, fromMrp)));
        if (qtyFromRate) {
          notes.push(`${label}: quantity read as ${l.qty}, but the printed amount ₹${rs(l.amount!)} at ₹${rs(qtyFromRate.r)} each means ${qtyFromRate.q}, so I used that.`);
          l.qty = qtyFromRate.q!;
          net = a! / l.qty;
          amountTrusted = true;
        } else if (fromMrp != null && close(printedRate, fromMrp)) {
          net = printedRate;
          notes.push(`${label}: the printed amount ₹${rs(l.amount!)} doesn't match ${l.qty} × ₹${rs(printedRate)}; the rate agrees with the MRP, so I kept the rate. Check the quantity.`);
        } else {
          net = fromAmount;
          amountTrusted = true;
          notes.push(`${label}: rate read as ₹${rs(printedRate)}, but the printed amount ₹${rs(l.amount!)} for ${l.qty} gives ₹${rs(net)}, so I used that. Check it.`);
        }
      }
    }
    l.rate = exact(net);
    l.discountPct = 0;
    // The printed amount (before tax) is kept where it is exact, so the bill can be entered to the paisa.
    l.amount = amountTrusted && !inclusive ? exact(a!) : null;
  });
  const base = (l: (typeof lines)[number]) => l.amount ?? l.qty * l.rate;

  // 4. Each row's own tax tells its GST rate.
  lines.forEach((l, i) => {
    if (l.taxAmount == null || l.taxAmount <= 0) return;
    const implied = rateFromTax(l.taxAmount, base(l));
    if (implied != null && implied !== l.gstPct) {
      notes.push(`Line ${i + 1} (${short(l.description)}): GST read as ${l.gstPct ?? "?"}%, but its tax ₹${rs(l.taxAmount)} on ₹${rs(base(l))} is ${implied}%, so I used ${implied}%.`);
      l.gstPct = implied;
    }
  });

  // 5. The printed tax summary by rate: one row at the wrong rate shows up as two rates that don't add up.
  if (summary.length) {
    const sumAt = (r: number) => lines.filter((l) => (l.gstPct ?? 0) === r).reduce((s, l) => s + base(l), 0);
    const off = () => summary.filter((s) => Math.abs(sumAt(s.ratePct) - s.taxable) > 1);
    if (off().length) {
      const fix = lines
        .flatMap((l, i) => summary.filter((s) => s.ratePct !== (l.gstPct ?? 0)).map((s) => ({ i, to: s.ratePct })))
        .filter(({ i, to }) => {
          const was = lines[i].gstPct;
          lines[i].gstPct = to;
          const ok = off().length === 0;
          lines[i].gstPct = was;
          return ok;
        });
      if (fix.length === 1) {
        const l = lines[fix[0].i];
        notes.push(`Line ${fix[0].i + 1} (${short(l.description)}): GST read as ${l.gstPct ?? "?"}%, but the bill's tax summary only adds up with it at ${fix[0].to}%, so I used ${fix[0].to}%.`);
        l.gstPct = fix[0].to;
      }
    }
  }

  // 6. The grand total: if it still doesn't add up, one row (or the whole bill) at another GST rate may explain it.
  if (read.total != null && read.total > 0) {
    const totalWith = (g: (l: (typeof lines)[number], i: number) => number) => lines.reduce((s, l, i) => s + base(l) * (1 + g(l, i) / 100), 0);
    const now = totalWith((l) => l.gstPct ?? 0);
    if (Math.abs(now - read.total) > 1) {
      const singles = lines.flatMap((l, i) =>
        GST_RATES.filter((r) => r !== (l.gstPct ?? 0) && Math.abs(totalWith((x, j) => (j === i ? r : (x.gstPct ?? 0))) - read.total!) <= 1).map((to) => ({ i, to })),
      );
      const whole = GST_RATES.filter((r) => Math.abs(totalWith(() => r) - read.total!) <= 1);
      if (singles.length === 1) {
        const l = lines[singles[0].i];
        notes.push(`Line ${singles[0].i + 1} (${short(l.description)}): GST read as ${l.gstPct ?? "?"}%, but the bill's total only adds up with it at ${singles[0].to}%, so I used ${singles[0].to}%. Check it.`);
        l.gstPct = singles[0].to;
      } else if (singles.length === 0 && whole.length === 1) {
        notes.push(`The GST rates read don't make the bill's total; it adds up with every line at ${whole[0]}%, so I used that. Check it.`);
        for (const l of lines) l.gstPct = whole[0];
      }
    }
  }

  // 7. The bill's own totals: do the lines add up to them?
  if (read.subtotal != null && read.subtotal > 0) {
    const compare = lines.reduce((s, l) => s + (inclusive && l.amount == null ? l.qty * l.rate * (1 + (l.gstPct ?? 0) / 100) : base(l)), 0);
    const sub = inclusive ? lines.reduce((s, l) => s + base(l) * (1 + (l.gstPct ?? 0) / 100), 0) : compare;
    if (!close(sub, read.subtotal)) notes.push(`The lines add up to ₹${rs(sub)} but the bill's own subtotal is ₹${rs(read.subtotal)}. A line may be misread or missing.`);
  }
  if (read.totalQty != null && read.totalQty > 0) {
    const q = lines.reduce((s, l) => s + l.qty, 0);
    if (Math.abs(q - read.totalQty) > 0.001) notes.push(`The quantities add up to ${q} but the bill says ${read.totalQty} in total.`);
  }
  return { read: { ...read, lines }, notes };
}
