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

// ─── Bills that failed on the live bot (October 2026) ──────────────────────────

type Row = [string, number, number, number, number, number, number]; // name, qty, MRP, DIS %, RATE, GST %, AMOUNT
const rows = (rs: Row[]): Line[] => rs.map(([description, qty, mrp, discountPct, rate, gstPct, amount]) => ({ description, matchedCode: null, hsn: null, qty, unit: null, rate, gstPct, discountPct, mrp, amount }));
const grand = (ls: Line[]) => ls.reduce((s, l) => s + (l.amount ?? l.qty * l.rate) * (1 + (l.gstPct ?? 0) / 100), 0);

/** S P Homoeo Medicals A004108: 12 rows, one at 18% (the sunscreen). */
const A004108: Row[] = [
  ["ASTHA AID SYRUP 450ML", 3, 340, 43, 193.8, 5, 581.4],
  ["B&T SUN SCREEN EXPERT 100GM", 3, 320, 33, 214.4, 18, 643.2],
  ["CIMICIFUGA RACEMOSA Q SBL 100ML", 1, 540, 43, 307.8, 5, 307.8],
  ["CME EYE DROPS SBL 10ML", 2, 122, 43, 69.54, 5, 139.08],
  ["CME EYE DROPS SBL 10ML", 2, 122, 43, 69.54, 5, 139.08],
  ["CONTINIL DROPS SBL 30ML", 10, 131, 43, 74.67, 5, 746.7],
  ["ENUKIND 10GM", 1, 140, 35, 91, 5, 91],
  ["EUPHARASIA 10% 10ML", 3, 95, 42, 55.1, 5, 165.3],
  ["MULLIEN EAR DROPS SBL 10ML", 4, 66, 43, 37.62, 5, 150.48],
  ["PROSTONUM 30ML", 4, 178, 43, 101.46, 5, 405.84],
  ["R1 TO 81 EXPT8,15,30 22ML", 15, 295, 28, 212.4, 5, 3186],
  ["R1 TO 81 EXPT8,15,30 22ML", 2, 325, 28, 234, 5, 468],
];

describe("GST rates misread on a real bill (S P Homoeo A004108: ₹7,375 in the app, ₹7,459 printed)", () => {
  const misread = () => {
    const ls = rows(A004108);
    ls[1].gstPct = 5; // the AI read the sunscreen's 18% as 5%
    return ls;
  };

  it("the grand total alone pins down the one row at the wrong rate", () => {
    const { read, notes } = reconcile(bill(misread(), { total: 7459, subtotal: 7023.88, totalQty: 50 }));
    expect(read.lines[1].gstPct).toBe(18);
    expect(notes.join("\n")).toMatch(/Line 2 \(B&T SUN SCREEN EXPERT 100GM\): GST read as 5%.*total only adds up with it at 18%/);
    expect(Math.round(grand(read.lines))).toBe(7459);
  });

  it("the row's own tax column says it directly", () => {
    const ls = misread();
    ls[1].taxAmount = 115.78;
    const { read, notes } = reconcile(bill(ls, { total: 7459, subtotal: 7023.88, totalQty: 50 }));
    expect(read.lines[1].gstPct).toBe(18);
    expect(notes.join("\n")).toMatch(/its tax ₹115\.78 on ₹643\.20 is 18%/);
  });

  it("so does the printed tax summary by rate", () => {
    const { read, notes } = reconcile(bill(misread(), { total: null, subtotal: 7023.88, totalQty: 50, gstSummary: [{ ratePct: 5, taxable: 6380.68, tax: 319.08 }, { ratePct: 18, taxable: 643.2, tax: 115.78 }] }));
    expect(read.lines[1].gstPct).toBe(18);
    expect(notes.join("\n")).toMatch(/tax summary only adds up with it at 18%/);
  });
});

/** Veepack Packaging B2C/00982: CGST 9% + SGST 9%, unit prices printed rounded (".72" for ₹720.34 / 1000). */
const B2C_00982: [string, number, number, number][] = [
  ["10ML PLASTIC BOTTLES - CLEAR", 1000, 0.72, 720.34],
  ["15ML PLASTIC BOTTLES - CLEAR", 500, 1.19, 593.22],
  ["60ML PET BOTTLES", 360, 2.37, 854.24],
  ["100ML PET BOTTLES 12GM", 240, 2.54, 610.17],
  ["30ML PET BOTTLES - CLEAR", 238, 2.03, 484.07],
  ["15ML PET BOTTLE CLEAR", 247, 2.03, 502.37],
  ["25MM PET LOCK CAP", 1085, 0.68, 735.59],
  ["15ML PLASTIC JAR - 1st", 288, 0.88, 254.24],
];
const veepack = (gst: number): Line[] => B2C_00982.map(([description, qty, rate, amount]) => ({ description, matchedCode: null, hsn: "3923", qty, unit: "Nos", rate, gstPct: gst, discountPct: 0, mrp: null, amount }));

describe("CGST/SGST bills with prices finer than a paisa (Veepack B2C/00982: ₹5,181 in the app, ₹5,610 printed)", () => {
  it("9% read from the CGST column becomes the full 18%", () => {
    const { read, notes } = reconcile(bill(veepack(9), { total: 5610, subtotal: 4754.24, totalQty: 3958 }));
    expect(read.lines.every((l) => l.gstPct === 18)).toBe(true);
    expect(notes[0]).toMatch(/GST was read as 9%.*CGST.*full 18%/);
  });

  it("each line keeps its printed amount exactly, and the rate to the sub-paisa", () => {
    const { read, notes } = reconcile(bill(veepack(18), { total: 5610, subtotal: 4754.24, totalQty: 3958 }));
    expect(read.lines.map((l) => l.amount)).toEqual(B2C_00982.map((r) => r[3]));
    expect(read.lines[0].rate).toBe(0.72034);
    expect(notes).toEqual([]);
    expect(read.lines.reduce((s, l) => s + l.amount!, 0)).toBeCloseTo(4754.24, 2);
  });
});

describe("a VALUE (tax) column taken for the AMOUNT", () => {
  it("is recognised as the row's tax, and the row is priced from its rate", () => {
    // S P Homoeo A002784, row 1: 5 × ₹78.20 at 18%: VALUE 70.38 is the tax, AMOUNT 391.00 the amount.
    const { read } = reconcile(bill([{ description: "B&T CALENDULA CREAM 100GM", matchedCode: null, hsn: null, qty: 5, unit: null, rate: 78.2, gstPct: 18, discountPct: 32, mrp: 115, amount: 70.38 }], { total: null, subtotal: null, totalQty: null }));
    expect(read.lines[0]).toMatchObject({ qty: 5, rate: 78.2, taxAmount: 70.38, amount: null });
  });
});
