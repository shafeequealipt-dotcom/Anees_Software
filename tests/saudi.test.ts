import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, taxRates } from "@/db/schema";
import { amountInWords } from "@/lib/amount-in-words";
import { financialYear } from "@/lib/dates";
import { calculateVoucher, supplyFor } from "@/lib/gst/engine";
import { checkTrn } from "@/lib/gst/trn";
import { formatMoney } from "@/lib/money";
import { setRegion } from "@/lib/region";
import { decodeZatcaQr, zatcaQrBase64 } from "@/lib/zatca";
import { saveItem, saveParty } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { getVoucher, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

afterAll(() => setRegion("IN"));

describe("Saudi Arabia formatting", () => {
  it("shows riyals with international digit grouping", () => {
    setRegion("SA");
    expect(formatMoney(123456789)).toBe("SAR 1,234,567.89");
    expect(formatMoney(-5000)).toBe("-SAR 50.00");
    setRegion("IN");
    expect(formatMoney(123456789)).toBe("₹12,34,567.89");
  });
  it("writes amounts in words", () => {
    setRegion("SA");
    expect(amountInWords(115050)).toBe("Saudi One Thousand One Hundred Fifty Riyals and Fifty Halalas Only");
    expect(amountInWords(250000000)).toBe("Saudi Two Million Five Hundred Thousand Riyals Only");
    setRegion("IN");
  });
  it("uses the calendar year as the financial year", () => {
    setRegion("SA");
    expect(financialYear("2026-09-19")).toEqual({ label: "2026", from: "2026-01-01", to: "2026-12-31" });
    setRegion("IN");
    expect(financialYear("2026-09-19").label).toBe("2026-27");
  });
});

describe("Saudi VAT", () => {
  it("validates the 15-digit VAT number", () => {
    expect(checkTrn("300000000000003").ok).toBe(true);
    expect(checkTrn("30000000000003").ok).toBe(false);
    expect(checkTrn("400000000000003").ok).toBe(false);
    expect(checkTrn("30000000000000A").ok).toBe(false);
  });
  it("charges one 15% VAT, never CGST/SGST", () => {
    expect(supplyFor("SA", null, null)).toBe("inter");
    const r = calculateVoucher({ supply: "inter", roundOff: false, lines: [{ qtyMilli: 2000, ratePaise: 10000, rateIncludesTax: false, gstBp: 1500 }] });
    expect(r.igstPaise).toBe(3000);
    expect(r.cgstPaise + r.sgstPaise).toBe(0);
    expect(r.totalPaise).toBe(23000);
  });
  it("builds a ZATCA Phase 1 QR that decodes back to the invoice details", () => {
    const qr = zatcaQrBase64({ sellerName: "شركة الأمل", vatNumber: "300000000000003", timestamp: "2026-09-19T10:30:00Z", totalPaise: 115000, vatPaise: 15000 });
    expect(decodeZatcaQr(qr)).toEqual({ 1: "شركة الأمل", 2: "300000000000003", 3: "2026-09-19T10:30:00Z", 4: "1150.00", 5: "150.00" });
  });
});

describe("Saudi business end to end", () => {
  let db: DB;
  let firmId: number;
  beforeAll(async () => {
    db = await testDb();
    await runFirstSetup(db, { businessName: "Al Amal Trading", country: "SA", gstin: "300000000000003", ownerName: "Owner", email: "owner@amal.example", password: "Tulsi-Garden-4471" });
    [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  });

  it("sets up with Saudi tax rates, no state needed", async () => {
    const [f] = await db.select().from(firms).where(eq(firms.id, firmId));
    expect(f).toMatchObject({ country: "SA", stateCode: null, gstin: "300000000000003", gstScheme: "regular" });
    const rates = await db.select().from(taxRates);
    expect(rates.map((r) => r.name)).toEqual(expect.arrayContaining(["VAT 15%", "Zero-rated (0%)", "Exempt"]));
    expect(rates.some((r) => r.name.startsWith("GST"))).toBe(false);
  });

  it("issues an invoice with VAT in a single column and no place of supply", async () => {
    setRegion("SA");
    const vat = (await db.select().from(taxRates)).find((r) => r.gstBp === 1500)!;
    const cust = await saveParty(db, firmId, { name: "Riyadh Stores", gstin: "310000000000003", kind: "customer" }, 1);
    const item = await saveItem(db, firmId, { name: "Dates 1kg", salePricePaise: 5000, taxRateId: vat.id, openingQtyMilli: 100000 }, 1);
    const res = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-19", partyId: cust, roundOff: false, lines: [{ itemId: item, description: "Dates 1kg", qtyMilli: 10000, ratePaise: 5000, taxRateId: vat.id }] }, 1);
    const v = (await getVoucher(db, firmId, res.id))!.voucher;
    expect(v).toMatchObject({ taxablePaise: 50000, igstPaise: 7500, cgstPaise: 0, sgstPaise: 0, totalPaise: 57500, placeOfSupply: null });
  });

  it("rejects a malformed VAT number for a customer, and accepts none", async () => {
    setRegion("SA");
    await expect(saveParty(db, firmId, { name: "Bad Co", gstin: "12345" }, 1)).rejects.toThrow(/15 digits/);
    await expect(saveParty(db, firmId, { name: "Walk-in Co" }, 1)).resolves.toBeTypeOf("number");
  });

  it("India without GST number or state still sets up", async () => {
    const db2 = await testDb();
    await runFirstSetup(db2, { businessName: "Small Shop", ownerName: "Owner", email: "o@shop.example", password: "Tulsi-Garden-4471", stateCode: "" });
    const [f] = await db2.select().from(firms);
    expect(f).toMatchObject({ country: "IN", stateCode: null, gstin: null, gstScheme: "unregistered" });
  });
});
