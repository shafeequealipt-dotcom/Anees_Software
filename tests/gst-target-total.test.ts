import { describe, expect, it } from "vitest";
import { calculateVoucher } from "@/lib/gst/engine";

const line = { qtyMilli: 1000, ratePaise: 745874, rateIncludesTax: false, gstBp: 0 };

describe("rounding a purchase bill to the supplier's printed total", () => {
  it("takes the printed total when it is within ₹1 of the calculation", () => {
    expect(calculateVoucher({ lines: [line], supply: "intra", roundOff: true, targetTotalPaise: 745900 })).toMatchObject({ totalPaise: 745900, roundOffPaise: 26 });
    // A supplier that rounded ₹7,458.49 up: plain rounding would give ₹7,458.
    expect(calculateVoucher({ lines: [{ ...line, ratePaise: 745849 }], supply: "intra", roundOff: true, targetTotalPaise: 745900 })).toMatchObject({ totalPaise: 745900, roundOffPaise: 51 });
  });

  it("ignores a printed total more than ₹1 away (a misread), and plain rounding applies", () => {
    expect(calculateVoucher({ lines: [line], supply: "intra", roundOff: true, targetTotalPaise: 746100 }).totalPaise).toBe(745900);
    expect(calculateVoucher({ lines: [line], supply: "intra", roundOff: false, targetTotalPaise: 745900 }).totalPaise).toBe(745874);
  });
});
