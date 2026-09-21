import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { firms } from "@/db/schema";
import { deleteImage, getImage, imageDataUrls, saveImage, sniffImage } from "@/server/company-images";
import { loadInvoiceModel } from "@/server/invoice";
import { renderInvoicePdf } from "@/server/pdf/invoice-pdf";
import { saveSettings } from "@/lib/settings";
import { savePreferences } from "@/server/preferences";
import { getSettings } from "@/lib/settings";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let db: DB;
let firmId: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
});

describe("logo and signature", () => {
  it("recognises PNG and JPEG by content, not by name", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("<svg></svg>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a......"))).toBeNull();
  });

  it("stores, replaces and removes an image, and refuses bad or huge files", async () => {
    await saveImage(db, firmId, "logo", PNG, 1);
    expect((await getImage(db, firmId, "logo"))!.mime).toBe("image/png");
    expect((await imageDataUrls(db, firmId)).logo).toMatch(/^data:image\/png;base64,/);
    await expect(saveImage(db, firmId, "logo", Buffer.from("not an image"), 1)).rejects.toThrow(/PNG or JPEG/);
    await expect(saveImage(db, firmId, "logo", Buffer.concat([PNG, Buffer.alloc(500 * 1024)]), 1)).rejects.toThrow(/too big/);
    await expect(saveImage(db, firmId, "signature", Buffer.alloc(0), 1)).rejects.toThrow(/Choose an image/);
    await deleteImage(db, firmId, "logo", 1);
    expect(await getImage(db, firmId, "logo")).toBeNull();
  });
});

describe("invoice style and paper", () => {
  it("follows the company's settings, and a receipt can be asked for on one bill", async () => {
    await saveImage(db, firmId, "logo", PNG, 1);
    const v = await saveVoucher(db, firmId, { type: "expense", date: "2026-09-20", lines: [{ description: "x", qtyMilli: 1000, ratePaise: 1000 }] }, 1);
    let m = (await loadInvoiceModel(db, firmId, v.id))!;
    expect(m).toMatchObject({ paper: "A4", layout: "classic" });
    expect(m.logo).toMatch(/^data:image\/png/);

    await savePreferences(db, firmId, { ...(await currentPrefs()), printPaperSize: "thermal", thermalWidthMm: 58, invoiceLayout: "modern", invoiceAccentColor: "#0f766e" }, 1);
    m = (await loadInvoiceModel(db, firmId, v.id))!;
    expect(m).toMatchObject({ paper: "T58", layout: "modern", accent: "#0f766e" });
    expect((await loadInvoiceModel(db, firmId, v.id, { paper: "A5" }))!.paper).toBe("A5");
    for (const paper of ["A4", "A5", "T80", "T58"] as const) {
      const pdf = await renderInvoicePdf((await loadInvoiceModel(db, firmId, v.id, { paper }))!);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
    await expect(savePreferences(db, firmId, { ...(await currentPrefs()), invoiceAccentColor: "red" }, 1)).rejects.toThrow(/colour/);
    void saveSettings;
  });
});

async function currentPrefs() {
  const s = await getSettings(db, firmId);
  return {
    creditLimitMode: s.creditLimitMode, allowNegativeStock: s.allowNegativeStock, roundOff: s.roundOff, lineDiscount: s.lineDiscount, billDiscount: s.billDiscount,
    defaultPriceIncludesTax: s.defaultPriceIncludesTax, showMrp: s.showMrp, invoiceLanguage: s.invoiceLanguage, printPaperSize: s.printPaperSize, thermalWidthMm: s.thermalWidthMm, invoiceLayout: s.invoiceLayout,
    invoiceAccentColor: s.invoiceAccentColor, showBankDetailsOnInvoice: s.showBankDetailsOnInvoice, showUpiQrOnInvoice: s.showUpiQrOnInvoice, tdsTcsEnabled: s.tdsTcsEnabled,
    quotationTerms: s.quotationTerms, prefixes: s.prefixes,
  };
}
