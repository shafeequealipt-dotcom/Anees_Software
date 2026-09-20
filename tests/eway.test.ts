import { describe, expect, it } from "vitest";
import { buildEwayBill, pincodeFrom, type EwayInput } from "@/lib/eway";

const base: EwayInput = {
  firm: { gstin: "27ABCDE1234F1Z5", name: "Test Traders", address: "Shop 1, Laxmi Road\nPune", city: "Pune", pincode: "411030", stateCode: "27" },
  bill: { number: "INV-12", date: "2026-09-20", partyGstin: "29AAAAA0000A1Z5", partyName: "Bengaluru Mart", billingAddress: "MG Road, Bengaluru 560001", shippingAddress: null, placeOfSupply: "29", partyStateCode: "29", taxablePaise: 100_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000, cessPaise: 0, totalPaise: 118_000, vehicleNo: "mh 12 ab 1234", transportName: "Speedy", otherValuePaise: 0 },
  lines: [{ description: "Blue pen", hsn: "9608", qtyMilli: 10_000, unitCode: "PCS", taxablePaise: 100_000, gstBp: 1800, cessBp: 0, intra: false }],
};

describe("e-way bill file", () => {
  it("finds a PIN code in an address", () => {
    expect(pincodeFrom("MG Road, Bengaluru 560001")).toBe("560001");
    expect(pincodeFrom("Tel 9822012345, Pune")).toBeNull();
  });

  it("maps an inter-state bill to IGST and the portal's field names", () => {
    const r = buildEwayBill(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = (r.json as { billLists: Record<string, unknown>[] }).billLists[0];
    expect(b).toMatchObject({ userGstin: "27ABCDE1234F1Z5", supplyType: "O", docType: "INV", docNo: "INV-12", docDate: "20/09/2026", toGstin: "29AAAAA0000A1Z5", fromPincode: 411030, toPincode: 560001, fromStateCode: 27, toStateCode: 29, totalValue: 1000, igstValue: 180, totInvValue: 1180, vehicleNo: "MH12AB1234" });
    expect((b.itemList as Record<string, unknown>[])[0]).toMatchObject({ hsnCode: 9608, quantity: 10, qtyUnit: "PCS", igstRate: 18, cgstRate: 0, taxableAmount: 1000 });
  });

  it("splits the rate into CGST and SGST inside the state, and uses URP for an unregistered customer", () => {
    const r = buildEwayBill({ ...base, bill: { ...base.bill, partyGstin: null, placeOfSupply: "27", partyStateCode: "27", billingAddress: "Kothrud, Pune 411038", igstPaise: 0, cgstPaise: 9_000, sgstPaise: 9_000 }, lines: [{ ...base.lines[0], intra: true, unitCode: "Bundle" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = (r.json as { billLists: { toGstin: string; itemList: Record<string, unknown>[] }[] }).billLists[0];
    expect(b.toGstin).toBe("URP");
    expect(b.itemList[0]).toMatchObject({ cgstRate: 9, sgstRate: 9, igstRate: 0, qtyUnit: "OTH" });
  });

  it("says exactly what is missing", () => {
    const r = buildEwayBill({ ...base, firm: { ...base.firm, pincode: null, address: null }, bill: { ...base.bill, billingAddress: "Somewhere" }, lines: [{ ...base.lines[0], hsn: null }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toMatch(/PIN code is missing/);
    expect(r.problems.join(" ")).toMatch(/customer's address needs a 6-digit PIN/);
    expect(r.problems.join(" ")).toMatch(/no HSN/);
  });
});
