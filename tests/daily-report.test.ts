import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations } from "@/db/schema";
import { saveItem, saveParty } from "@/server/masters";
import { loadDailyReportModel } from "@/server/daily-report";
import { runDailyReportEmail } from "@/server/notify/daily-report-job";
import { renderDailyReportPdf } from "@/server/pdf/daily-report-pdf";
import { dailySalesReport, staffSales } from "@/server/reports";
import { getSettings, saveSettings } from "@/lib/settings";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let warehouseId: number;
let shopId: number;
let widget: number;
let customer: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  const locs = await db.select().from(locations).where(eq(locations.firmId, firmId));
  warehouseId = locs.find((l) => l.kind === "warehouse")!.id;
  shopId = locs.find((l) => l.kind === "shop")!.id;
  widget = await saveItem(db, firmId, { name: "Widget", salePricePaise: 1_000, purchasePricePaise: 500 }, 1);
  customer = await saveParty(db, firmId, { kind: "customer", name: "Cust One" }, 1);

  await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-09-01", locationId: warehouseId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 100_000, ratePaise: 500 }] }, 1);
  await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-01", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 50_000, ratePaise: 0 }] }, 1);

  // Two cash sales and one credit sale at the shop on 2026-09-10.
  await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-10", locationId: shopId, paymentMode: "Cash", lines: [{ itemId: widget, description: "Widget", qtyMilli: 5_000, ratePaise: 1_000 }] }, 1);
  await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-10", locationId: shopId, paymentMode: "UPI", lines: [{ itemId: widget, description: "Widget", qtyMilli: 3_000, ratePaise: 1_000 }] }, 1);
  const credit = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-10", locationId: shopId, partyId: customer, paidPaise: 0, lines: [{ itemId: widget, description: "Widget", qtyMilli: 2_000, ratePaise: 1_000 }] }, 1);
  // A return, same day, same shop.
  await saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-10", sourceVoucherId: credit.id, lines: [{ itemId: widget, description: "Widget", qtyMilli: 1_000, ratePaise: 1_000 }] }, 1);
  // A sale at the warehouse the same day, to prove location filtering works.
  await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-10", locationId: warehouseId, paymentMode: "Cash", lines: [{ itemId: widget, description: "Widget", qtyMilli: 10_000, ratePaise: 1_000 }] }, 1);
});

describe("daily sales report", () => {
  it("totals one shop's day correctly", async () => {
    const r = await dailySalesReport(db, firmId, "2026-09-10", shopId);
    expect(r.bills).toBe(3);
    expect(r.grossSalesPaise).toBe(5_000 + 3_000 + 2_000); // 10,000
    expect(r.returnCount).toBe(1);
    expect(r.returnsPaise).toBe(1_000);
    expect(r.netSalesPaise).toBe(9_000);
    expect(r.unpaidPaise).toBe(2_000); // the credit sale, unpaid
    expect(r.locationName).toBe("Main shop");
  });

  it("breaks payments down by mode, combining cash sales and cash paid on bill", async () => {
    const r = await dailySalesReport(db, firmId, "2026-09-10", shopId);
    const cash = r.byPaymentMode.find((m) => m.mode === "Cash");
    const upi = r.byPaymentMode.find((m) => m.mode === "UPI");
    expect(cash?.amountPaise).toBe(5_000);
    expect(upi?.amountPaise).toBe(3_000);
  });

  it("lists top items and per-staff totals", async () => {
    const r = await dailySalesReport(db, firmId, "2026-09-10", shopId);
    expect(r.topItems[0].name).toBe("Widget");
    expect(r.topItems[0].amountPaise).toBe(10_000);
    expect(r.byStaff).toHaveLength(1);
    expect(r.byStaff[0].salesPaise).toBe(10_000);
    expect(r.byStaff[0].returnsPaise).toBe(1_000);
  });

  it("without a shop, totals the whole company for the day", async () => {
    const r = await dailySalesReport(db, firmId, "2026-09-10");
    expect(r.bills).toBe(4); // 3 at the shop + 1 at the warehouse
    expect(r.grossSalesPaise).toBe(10_000 + 10_000);
    expect(r.locationName).toBeNull();
  });

  it("a shop with no activity on the day reports zeros, not an error", async () => {
    const r = await dailySalesReport(db, firmId, "2026-09-11", shopId);
    expect(r.bills).toBe(0);
    expect(r.grossSalesPaise).toBe(0);
    expect(r.topItems).toEqual([]);
    expect(r.byStaff).toEqual([]);
  });
});

describe("staff sales", () => {
  it("aggregates one staff member's sales and returns over the period, per shop", async () => {
    const shopRows = await staffSales(db, firmId, "2026-09-01", "2026-09-30", shopId);
    expect(shopRows).toHaveLength(1);
    expect(shopRows[0].name).toBe("Owner");
    expect(shopRows[0].bills).toBe(3);
    expect(shopRows[0].salesPaise).toBe(10_000);
    expect(shopRows[0].returnsPaise).toBe(1_000);
    expect(shopRows[0].netPaise).toBe(9_000);

    const allRows = await staffSales(db, firmId, "2026-09-01", "2026-09-30");
    expect(allRows[0].bills).toBe(4);
    expect(allRows[0].salesPaise).toBe(20_000);
  });
});

describe("daily report PDF", () => {
  it("renders an A4 report and both thermal slip sizes without crashing", async () => {
    for (const paper of ["A4", "T80", "T58"] as const) {
      const model = await loadDailyReportModel(db, firmId, "2026-09-10", shopId, { paper });
      expect(model).not.toBeNull();
      const pdf = await renderDailyReportPdf(model!);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
  });

  it("shows 'All shops' when no location is chosen", async () => {
    const model = await loadDailyReportModel(db, firmId, "2026-09-10", undefined, { paper: "A4" });
    expect(model!.locationLabel).toBe("All shops");
  });
});

describe("automatic daily report email", () => {
  it("does nothing when turned off, or when no owner email is set, and never marks the day as sent", async () => {
    await saveSettings(db, firmId, { dailyReportEnabled: false });
    expect((await runDailyReportEmail(db, firmId)).sent).toBe(false);

    await saveSettings(db, firmId, { dailyReportEnabled: true, notifyOwnerEmail: "" });
    expect((await runDailyReportEmail(db, firmId)).sent).toBe(false);

    // Neither attempt should have touched the "already sent" marker (no real SMTP server here).
    const s = await getSettings(db, firmId);
    expect(s.dailyReportLastSentDate).toBe("");
  });
});
