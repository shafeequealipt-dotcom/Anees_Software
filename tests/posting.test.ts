import { describe, expect, it } from "vitest";
import { buildPostings, PostingError, type PostingVoucher } from "@/lib/posting";
import { checkGstin, gstinCheckDigit } from "@/lib/gst/gstin";
import { amountInWords } from "@/lib/amount-in-words";

const base: PostingVoucher = {
  type: "sale_invoice",
  date: "2026-09-16",
  status: "active",
  partyId: 7,
  totalPaise: 118000,
  paidPaise: 0,
  accountId: null,
  toAccountId: null,
  direction: null,
  lines: [{ itemId: 3, isGoods: true, qtyMilli: 2000, unitFactorMilli: 1000, taxablePaise: 100000 }],
};

describe("buildPostings", () => {
  it("credit sale: party owes the total, stock goes out", () => {
    const p = buildPostings(base);
    expect(p.party).toEqual([{ partyId: 7, date: "2026-09-16", amountPaise: 118000 }]);
    expect(p.money).toEqual([]);
    expect(p.stock[0].qtyMilli).toBe(-2000);
  });

  it("part-paid sale: balance left on the party, cash comes in", () => {
    const p = buildPostings({ ...base, paidPaise: 18000, accountId: 1 });
    expect(p.party.reduce((s, e) => s + e.amountPaise, 0)).toBe(100000);
    expect(p.money).toEqual([{ accountId: 1, date: "2026-09-16", amountPaise: 18000 }]);
  });

  it("cash sale without a party must be fully paid", () => {
    expect(() => buildPostings({ ...base, partyId: null })).toThrow(PostingError);
    const p = buildPostings({ ...base, partyId: null, paidPaise: 118000, accountId: 1 });
    expect(p.party).toEqual([]);
    expect(p.money[0].amountPaise).toBe(118000);
  });

  it("purchase bill: we owe the supplier, stock comes in at cost", () => {
    const p = buildPostings({ ...base, type: "purchase_bill" });
    expect(p.party[0].amountPaise).toBe(-118000);
    expect(p.stock[0]).toMatchObject({ qtyMilli: 2000, valuePaise: 100000 });
  });

  it("alternate unit converts to base units", () => {
    const p = buildPostings({
      ...base,
      lines: [{ itemId: 3, isGoods: true, qtyMilli: 2000, unitFactorMilli: 12000, taxablePaise: 0 }],
    });
    expect(p.stock[0].qtyMilli).toBe(-24000);
  });

  it("payment in reduces the receivable and adds money", () => {
    const p = buildPostings({ ...base, type: "payment_in", totalPaise: 5000, accountId: 2, lines: [] });
    expect(p.party[0].amountPaise).toBe(-5000);
    expect(p.money[0].amountPaise).toBe(5000);
  });

  it("payment out reduces the payable and takes money out", () => {
    const p = buildPostings({ ...base, type: "payment_out", totalPaise: 5000, accountId: 2, lines: [] });
    expect(p.party[0].amountPaise).toBe(5000);
    expect(p.money[0].amountPaise).toBe(-5000);
  });

  it("transfer moves money between two accounts", () => {
    const p = buildPostings({ ...base, type: "money_transfer", partyId: null, totalPaise: 700, accountId: 1, toAccountId: 2, lines: [] });
    expect(p.money.map((m) => m.amountPaise)).toEqual([-700, 700]);
  });

  it("services and cancelled vouchers don't move stock", () => {
    expect(buildPostings({ ...base, lines: [{ ...base.lines[0], isGoods: false }] }).stock).toEqual([]);
    expect(buildPostings({ ...base, status: "cancelled" })).toEqual({ party: [], money: [], stock: [] });
  });

  it("quotations touch nothing", () => {
    expect(buildPostings({ ...base, type: "quotation" })).toEqual({ party: [], money: [], stock: [] });
  });
});

describe("GSTIN", () => {
  it("accepts a GSTIN with a correct check digit", () => {
    const first14 = "27ABCDE1234F1Z";
    const gstin = first14 + gstinCheckDigit(first14);
    expect(checkGstin(gstin)).toMatchObject({ ok: true, stateCode: "27", pan: "ABCDE1234F" });
  });
  it("rejects a typo", () => {
    const first14 = "27ABCDE1234F1Z";
    const good = gstinCheckDigit(first14);
    const bad = good === "A" ? "B" : "A";
    expect(checkGstin(first14 + bad).ok).toBe(false);
    expect(checkGstin("12345").ok).toBe(false);
  });
});

describe("amountInWords", () => {
  it("uses lakh and crore", () => {
    expect(amountInWords(1234567800)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only");
    expect(amountInWords(10050)).toBe("One Hundred Rupees and Fifty Paise Only");
  });
});
