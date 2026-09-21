import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { firms, taxRates } from "@/db/schema";
import { gstinCheckDigit } from "@/lib/gst/gstin";
import { saveItem, saveParty } from "@/server/masters";
import { loadInvoiceModel } from "@/server/invoice";
import { renderInvoicePdf } from "@/server/pdf/invoice-pdf";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

async function pdfText(buf: Buffer) {
  return buf.subarray(0, 5).toString("latin1");
}

describe("invoice PDF", () => {
  it("Saudi tax invoice: VAT in one column, ZATCA QR, amount in riyals", async () => {
    const db = await testDb();
    await runFirstSetup(db, { businessName: "Al Amal Trading", country: "SA", gstin: "300000000000003", ownerName: "Owner", email: "o@amal.example", password: "Tulsi-Garden-4471" });
    const [f] = await db.select().from(firms);
    await db.update(firms).set({ bankName: "Al Rajhi", bankAccountNo: "SA0380000000608010167519", address: "Riyadh", nameAr: "شركة الأمل للتجارة", addressAr: "الرياض" }).where(eq(firms.id, f.id));
    const vat = (await db.select().from(taxRates).where(eq(taxRates.firmId, f.id))).find((r) => r.gstBp === 1500)!;
    const cust = await saveParty(db, f.id, { name: "Riyadh Stores", nameAr: "متاجر الرياض", gstin: "310000000000003", kind: "customer", billingAddress: "Olaya St" }, 1);
    const item = await saveItem(db, f.id, { name: "Dates 1kg", nameAr: "تمر ١ كجم", salePricePaise: 5000, taxRateId: vat.id, openingQtyMilli: 100000 }, 1);
    const res = await saveVoucher(db, f.id, { type: "sale_invoice", date: "2026-09-19", partyId: cust, roundOff: false, lines: [{ itemId: item, description: "Dates 1kg", qtyMilli: 10000, ratePaise: 5000, taxRateId: vat.id }] }, 1);

    const m = (await loadInvoiceModel(db, f.id, res.id))!;
    expect(m.currency).toBe("SAR");
    // Saudi companies print English and Arabic by default
    expect(m.language).toBe("bilingual");
    expect(m.title).toBe("Tax Invoice / فاتورة ضريبية");
    expect(m.qr?.caption).toBe("ZATCA QR code / رمز الاستجابة السريعة");
    expect(m.totals.map((t) => t.k)).toEqual(expect.arrayContaining(["Amount before tax / المبلغ قبل الضريبة", "VAT / ضريبة القيمة المضافة", "Total / الإجمالي"]));
    expect(m.totals.find((t) => t.k.startsWith("Total"))!.v).toBe("575.00");
    expect(m.words).toMatch(/Riyals/);
    expect(m.wordsAr).toBe("خمسمائة وخمسة وسبعون ريالاً سعودياً فقط لا غير");
    expect(m.bank.map((b) => b.k)).toContain("IBAN / account / الآيبان / الحساب");
    expect(m.ui.Item).toBe("Item / البند");
    expect(m.seller.nameAr).toBe("شركة الأمل للتجارة");
    expect(m.party.nameAr).toBe("متاجر الرياض");
    expect(m.lines[0].descAr).toBe("تمر ١ كجم");
    const pdf = await renderInvoicePdf(m);
    expect(await pdfText(pdf)).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);

    // The owner can choose English only, or Arabic only
    const { saveSettings } = await import("@/lib/settings");
    await saveSettings(db, f.id, { invoiceLanguage: "en" });
    const en = (await loadInvoiceModel(db, f.id, res.id))!;
    expect(en).toMatchObject({ language: "en", title: "Tax Invoice", wordsAr: null });
    expect(en.seller.nameAr).toBeNull();
    await saveSettings(db, f.id, { invoiceLanguage: "ar" });
    const onlyAr = (await loadInvoiceModel(db, f.id, res.id))!;
    expect(onlyAr.title).toBe("فاتورة ضريبية");
    expect(onlyAr.words).toBe("خمسمائة وخمسة وسبعون ريالاً سعودياً فقط لا غير");
    for (const model of [en, onlyAr]) expect((await renderInvoicePdf(model)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("Indian invoice: CGST + SGST split, HSN column, no ZATCA QR", async () => {
    const db = await testDb();
    await runFirstSetup(db, { businessName: "Test Traders", gstin: "27ABCDE1234F1Z" + gstinCheckDigit("27ABCDE1234F1Z"), gstScheme: "regular", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
    const [f] = await db.select().from(firms);
    const g18 = (await db.select().from(taxRates).where(eq(taxRates.firmId, f.id))).find((r) => r.gstBp === 1800 && r.nature === "taxable")!;
    const cust = await saveParty(db, f.id, { name: "Ravi Stores", stateCode: "27", kind: "customer" }, 1);
    const item = await saveItem(db, f.id, { name: "Blue pen", hsn: "9608", salePricePaise: 1000, taxRateId: g18.id, openingQtyMilli: 100000 }, 1);
    const res = await saveVoucher(db, f.id, { type: "sale_invoice", date: "2026-09-19", partyId: cust, lines: [{ itemId: item, description: "Blue pen", qtyMilli: 5000, ratePaise: 1000, taxRateId: g18.id }] }, 1);
    const m = (await loadInvoiceModel(db, f.id, res.id))!;
    expect(m.currency).toBe("INR");
    expect(m.split).toBe(true);
    expect(m.columns.hsn).toBe(true);
    expect(m.qr).toBeNull();
    expect(m.totals.map((t) => t.k)).toEqual(expect.arrayContaining(["CGST", "SGST"]));
    expect(m.words).toMatch(/Rupees/);
    expect(await pdfText(await renderInvoicePdf(m))).toBe("%PDF-");
  });

  it("won't load another company's invoice", async () => {
    const db = await testDb();
    await runFirstSetup(db, { businessName: "Shop", ownerName: "Owner", email: "o@s.example", password: "Tulsi-Garden-4471" });
    const [f] = await db.select().from(firms);
    const res = await saveVoucher(db, f.id, { type: "expense", date: "2026-09-19", lines: [{ description: "x", qtyMilli: 1000, ratePaise: 100 }] }, 1);
    expect(await loadInvoiceModel(db, f.id + 1, res.id)).toBeNull();
  });
});
