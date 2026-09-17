import { describe, expect, it } from "vitest";
import { calculateVoucher, supplyKind } from "@/lib/gst/engine";
import { allocateProRata, formatINR, toMilli, toPaise } from "@/lib/money";

describe("calculateVoucher", () => {
  it("splits 18% into 9% CGST + 9% SGST within the state", () => {
    const r = calculateVoucher({
      supply: "intra",
      roundOff: false,
      lines: [{ qtyMilli: toMilli(2), ratePaise: toPaise(500), rateIncludesTax: false, gstBp: 1800 }],
    });
    expect(r.taxablePaise).toBe(100000);
    expect(r.cgstPaise).toBe(9000);
    expect(r.sgstPaise).toBe(9000);
    expect(r.igstPaise).toBe(0);
    expect(r.totalPaise).toBe(118000);
  });

  it("charges IGST to another state", () => {
    const r = calculateVoucher({
      supply: "inter",
      roundOff: false,
      lines: [{ qtyMilli: 1000, ratePaise: 100000, rateIncludesTax: false, gstBp: 500 }],
    });
    expect(r.igstPaise).toBe(5000);
    expect(r.cgstPaise + r.sgstPaise).toBe(0);
    expect(r.totalPaise).toBe(105000);
  });

  it("keeps a tax-inclusive price exactly as entered", () => {
    const r = calculateVoucher({
      supply: "intra",
      roundOff: false,
      lines: [{ qtyMilli: 3000, ratePaise: 9999, rateIncludesTax: true, gstBp: 1800 }],
    });
    expect(r.totalPaise).toBe(29997);
    expect(r.taxablePaise + r.taxPaise).toBe(29997);
    expect(r.cgstPaise).toBe(r.sgstPaise);
  });

  it("applies line % discount before tax", () => {
    const r = calculateVoucher({
      supply: "intra",
      roundOff: false,
      lines: [{ qtyMilli: 1000, ratePaise: 100000, rateIncludesTax: false, discountBp: 1000, gstBp: 1800 }],
    });
    expect(r.lines[0].lineDiscountPaise).toBe(10000);
    expect(r.taxablePaise).toBe(90000);
    expect(r.totalPaise).toBe(106200);
  });

  it("spreads a bill discount across lines so the parts add up", () => {
    const r = calculateVoucher({
      supply: "intra",
      roundOff: false,
      billDiscountPaise: 1000,
      lines: [
        { qtyMilli: 1000, ratePaise: 3333, rateIncludesTax: false, gstBp: 500 },
        { qtyMilli: 1000, ratePaise: 3333, rateIncludesTax: false, gstBp: 1800 },
        { qtyMilli: 1000, ratePaise: 3334, rateIncludesTax: false, gstBp: 0 },
      ],
    });
    expect(r.lines.reduce((s, l) => s + l.billDiscountPaise, 0)).toBe(1000);
    expect(r.taxablePaise).toBe(9000);
    expect(r.byRate.map((b) => b.gstBp)).toEqual([0, 500, 1800]);
  });

  it("rounds the bill to the nearest rupee and records the round-off", () => {
    const r = calculateVoucher({
      supply: "intra",
      roundOff: true,
      lines: [{ qtyMilli: 1000, ratePaise: 10050, rateIncludesTax: false, gstBp: 1800 }],
    });
    expect(r.beforeRoundOffPaise).toBe(11860);
    expect(r.totalPaise).toBe(11900);
    expect(r.roundOffPaise).toBe(40);
  });

  it("charges no tax on a bill of supply", () => {
    const r = calculateVoucher({
      supply: "intra",
      roundOff: false,
      withoutTax: true,
      lines: [{ qtyMilli: 1000, ratePaise: 50000, rateIncludesTax: true, gstBp: 1800 }],
    });
    expect(r.taxPaise).toBe(0);
    expect(r.totalPaise).toBe(50000);
  });

  it("adds cess on top of GST", () => {
    const r = calculateVoucher({
      supply: "inter",
      roundOff: false,
      lines: [{ qtyMilli: 1000, ratePaise: 100000, rateIncludesTax: false, gstBp: 4000, cessBp: 1200 }],
    });
    expect(r.igstPaise).toBe(40000);
    expect(r.cessPaise).toBe(12000);
    expect(r.totalPaise).toBe(152000);
  });

  it("handles fractional quantities", () => {
    const r = calculateVoucher({
      supply: "intra",
      roundOff: false,
      lines: [{ qtyMilli: toMilli("1.25"), ratePaise: toPaise("80"), rateIncludesTax: false, gstBp: 0 }],
    });
    expect(r.totalPaise).toBe(10000);
  });
});

describe("helpers", () => {
  it("decides intra vs inter state", () => {
    expect(supplyKind("27", "27")).toBe("intra");
    expect(supplyKind("27", "29")).toBe("inter");
  });
  it("formats Indian currency", () => {
    expect(formatINR(123456789)).toBe("₹12,34,567.89");
    expect(formatINR(-5000)).toBe("-₹50.00");
  });
  it("parses rupee strings", () => {
    expect(toPaise("1,234.5")).toBe(123450);
    expect(Number.isNaN(toPaise("12a"))).toBe(true);
  });
  it("allocates exactly", () => {
    expect(allocateProRata(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});
