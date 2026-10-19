import { describe, expect, it } from "vitest";
import { reconcile } from "@/server/telegram/reconcile";
import type { ReadBill } from "@/server/telegram/read-bill";

type Line = ReadBill["lines"][number];

/** The printed rows of a real Marg-style GST invoice: name, pack, qty, MRP, DIS %, RATE, GST %, AMOUNT (before tax). */
const PRINTED: [string, string, number, number, number, number, number, number][] = [
  ["B&T CALENDULA & ALOEVERA CREAM", "100GM", 5, 115, 32, 78.2, 18, 391.0],
  ["B&T NEEM FACE WASH", "60ML", 3, 80, 32, 54.4, 18, 163.2],
  ["DILUTION 200CH", "100ML", 2, 185, 50, 92.5, 5, 185.0],
  ["DILUTION 200CH", "100ML", 3, 210, 50, 105.0, 5, 315.0],
  ["DILUTION 200CH", "100ML", 4, 230, 50, 115.0, 5, 460.0],
  ["DILUTION 30CH", "100ML", 2, 175, 50, 87.5, 5, 175.0],
  ["DILUTION 30CH", "100ML", 3, 200, 50, 100.0, 5, 300.0],
  ["DILUTION 30CH", "100ML", 1, 205, 50, 102.5, 5, 102.5],
  ["DILUTION 30CH", "100ML", 4, 215, 50, 107.5, 5, 430.0],
  ["DILUTION 30CH", "100ML", 2, 225, 50, 112.5, 5, 225.0],
  ["KM 6X WSI", "550GM", 2, 800, 43, 456.0, 5, 912.0],
  ["LIV T", "500ML", 1, 328, 43, 186.96, 5, 186.96],
  ["MULLIEN EAR DROPS SBL", "10ML", 2, 66, 43, 37.62, 5, 75.24],
  ["REFIRM D WSI", "30TAB", 9, 295, 35, 191.75, 5, 1725.75],
  ["SUNNY HAIR COLOR BLACK", "10GM", 12, 55, 32, 37.4, 18, 448.8],
  ["SUNNY HAIR COLOR DARK BROWN", "10GM", 12, 55, 32, 37.4, 18, 448.8],
  ["THYROIDINUM 3X SBL", "450GM", 1, 1125, 42, 652.5, 5, 652.5],
];

const line = ([description, , qty, mrp, discountPct, rate, gstPct, amount]: (typeof PRINTED)[number]): Line => ({ description, matchedCode: null, hsn: null, qty, unit: null, rate, gstPct, discountPct, mrp, amount });

const bill = (lines: Line[], extra: Partial<ReadBill> = {}): ReadBill => ({
  type: "purchase_bill",
  problem: null,
  supplier: { name: "S P HOMOEO MEDICALS", gstin: null, phone: null, address: null },
  billNo: "A002784",
  date: "2026-08-18",
  lines,
  total: 7745,
  category: null,
  description: null,
  subtotal: 7196.75,
  totalQty: 68,
  ...extra,
});

describe("reconciling a bill's own numbers", () => {
  it("a correctly read bill is untouched except that the rate becomes the price charged", () => {
    const { read, notes } = reconcile(bill(PRINTED.map(line)));
    expect(notes).toEqual([]);
    expect(read.lines.map((l) => [l.qty, l.rate])).toEqual(PRINTED.map((p) => [p[2], p[5]]));
    expect(read.lines.every((l) => l.discountPct === 0)).toBe(true);
  });

  it("repairs the four misreads seen on the real photo, each from the numbers that still agree", () => {
    const bad = PRINTED.map(line);
    bad[9] = { ...bad[9], qty: 1 }; // true 2
    bad[10] = { ...bad[10], rate: 43 }; // the DIS column taken for the rate; true 456.00
    bad[11] = { ...bad[11], rate: 156 }; // true 186.96
    bad[16] = { ...bad[16], rate: 62.5 }; // a dropped digit; true 652.50
    const { read, notes } = reconcile(bill(bad));
    expect(read.lines.map((l) => [l.qty, l.rate])).toEqual(PRINTED.map((p) => [p[2], p[5]]));
    expect(notes).toHaveLength(4);
    expect(notes.join("\n")).toMatch(/Line 11 \(KM 6X WSI\): rate read as ₹43\.00.*₹456\.00/);
    expect(notes.join("\n")).toMatch(/Line 10 .*quantity read as 1.*means 2/);
    // The lines now add up to the printed subtotal and total quantity, so there's no further doubt.
    const sum = read.lines.reduce((s, l) => s + l.qty * l.rate, 0);
    expect(sum).toBeCloseTo(7196.75, 2);
  });

  it("a rate printed as the list price with the discount applying is recognised from the amount", () => {
    const { read, notes } = reconcile(bill([{ description: "X", matchedCode: null, hsn: null, qty: 5, unit: null, rate: 115, discountPct: 32, gstPct: 18, mrp: null, amount: 391 }], { subtotal: null, totalQty: null }));
    expect(notes).toEqual([]);
    expect(read.lines[0]).toMatchObject({ rate: 78.2, discountPct: 0 });
  });

  it("without printed amounts, MRP tells whether the rate already has the discount", () => {
    const mk = (rate: number): Line => ({ description: "X", matchedCode: null, hsn: null, qty: 1, unit: null, rate, discountPct: 32, gstPct: 18, mrp: 115, amount: null });
    expect(reconcile(bill([mk(78.2)], { subtotal: null, totalQty: null })).read.lines[0].rate).toBe(78.2);
    expect(reconcile(bill([mk(115)], { subtotal: null, totalQty: null })).read.lines[0].rate).toBe(78.2);
  });

  it("tax-inclusive line amounts are recognised", () => {
    const { read, notes } = reconcile(bill([{ description: "X", matchedCode: null, hsn: null, qty: 2, unit: null, rate: 100, discountPct: 0, gstPct: 18, mrp: null, amount: 236 }], { subtotal: null, totalQty: null }));
    expect(notes).toEqual([]);
    expect(read.lines[0].rate).toBe(100);
  });

  it("without MRP, a quantity that makes the amount a clean multiple is taken as the fix; otherwise the amount's rate", () => {
    const base: Line = { description: "X", matchedCode: null, hsn: null, qty: 1, unit: null, rate: 112.5, discountPct: 0, gstPct: 5, mrp: null, amount: 225 };
    const a = reconcile(bill([base], { subtotal: null, totalQty: null }));
    expect(a.read.lines[0]).toMatchObject({ qty: 2, rate: 112.5 });
    const b = reconcile(bill([{ ...base, qty: 2, rate: 43, amount: 912 }], { subtotal: null, totalQty: null }));
    expect(b.read.lines[0]).toMatchObject({ qty: 2, rate: 456 });
    expect(b.notes[0]).toMatch(/Check it/);
  });

  it("says so when the lines still don't add up to the bill's own subtotal or quantity", () => {
    const lines = PRINTED.map(line).slice(0, 16); // a row missed
    const { notes } = reconcile(bill(lines));
    expect(notes.join("\n")).toMatch(/lines add up to ₹6544\.25 but the bill's own subtotal is ₹7196\.75/);
    expect(notes.join("\n")).toMatch(/quantities add up to 67 but the bill says 68/);
  });

  it("leaves expenses and empty readings alone", () => {
    const e = bill([], { type: "expense" });
    expect(reconcile(e)).toEqual({ read: e, notes: [] });
  });
});
