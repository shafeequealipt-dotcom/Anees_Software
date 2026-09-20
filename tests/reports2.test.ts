import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, taxRates, units } from "@/db/schema";
import { saveSettings } from "@/lib/settings";
import { saveItem, saveParty } from "@/server/masters";
import { batchStock, billProfit, groupByParty, serialReport, voucherProfit } from "@/server/profit-reports";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let gst18: number;
let pcs: number;
let ravi: number;
let mala: number;
let pen: number;
let phone: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  gst18 = (await db.select().from(taxRates).where(eq(taxRates.firmId, firmId))).find((r) => r.gstBp === 1800 && r.nature === "taxable")!.id;
  pcs = (await db.select().from(units).where(eq(units.firmId, firmId))).find((u) => u.code === "PCS")!.id;
  ravi = await saveParty(db, firmId, { name: "Ravi Stores", kind: "customer", stateCode: "27", creditLimitPaise: 50_000 }, 1);
  mala = await saveParty(db, firmId, { name: "Mala Traders", kind: "customer", stateCode: "27" }, 1);
  pen = await saveItem(db, firmId, { name: "Pen", unitId: pcs, salePricePaise: 1000, purchasePricePaise: 600, taxRateId: gst18, openingQtyMilli: 100_000, openingRatePaise: 600, trackBatches: true }, 1);
  phone = await saveItem(db, firmId, { name: "Phone", unitId: pcs, salePricePaise: 1_000_000, purchasePricePaise: 800_000, taxRateId: gst18, trackSerials: true }, 1);
});

const sale = (partyId: number, date: string, qty: number, rate: number, paid = 0) =>
  saveVoucher(db, firmId, { type: "sale_invoice", date, partyId, paidPaise: paid, lines: [{ itemId: pen, description: "Pen", qtyMilli: qty * 1000, ratePaise: rate, taxRateId: gst18 }] }, 1);

describe("profit reports", () => {
  it("bill-wise profit is sale price minus what the goods cost", async () => {
    const a = await sale(ravi, "2026-09-05", 10, 1000);
    const b = await sale(mala, "2026-09-06", 5, 900);
    const list = await billProfit(db, firmId, { from: "2026-09-01", to: "2026-09-30" });
    const ra = list.find((x) => x.id === a.id)!;
    expect(ra).toMatchObject({ revenue_paise: 10_000, cost_paise: 6_000, profit_paise: 4_000, margin_bp: 4000 });
    expect(list.find((x) => x.id === b.id)).toMatchObject({ revenue_paise: 4_500, cost_paise: 3_000, profit_paise: 1_500 });
    expect(await voucherProfit(db, firmId, a.id)).toMatchObject({ profitPaise: 4_000, marginBp: 4000 });
  });

  it("counts a sale return against profit and groups by party", async () => {
    await saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-08", partyId: ravi, lines: [{ itemId: pen, description: "Pen", qtyMilli: 2000, ratePaise: 1000, taxRateId: gst18 }] }, 1);
    const list = await billProfit(db, firmId, { from: "2026-09-01", to: "2026-09-30" });
    const by = groupByParty(list);
    const r = by.find((p) => p.party_name === "Ravi Stores")!;
    expect(r).toMatchObject({ revenue_paise: 8_000, cost_paise: 4_800, profit_paise: 3_200, bills: 1 });
    expect(by[0].profit_paise).toBeGreaterThanOrEqual(by[by.length - 1].profit_paise);
  });

  it("gives nothing for a purchase bill", async () => {
    const p = await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-09-02", partyId: mala, lines: [{ itemId: pen, description: "Pen", qtyMilli: 1000, ratePaise: 600 }] }, 1);
    expect(await voucherProfit(db, firmId, p.id)).toBeNull();
  });
});

describe("batches and serial numbers", () => {
  it("shows stock by batch with days to expiry", async () => {
    await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-09-10", partyId: mala, lines: [{ itemId: pen, description: "Pen", qtyMilli: 10_000, ratePaise: 600, batchNo: "B-1", expiryDate: "2026-11-01" }, { itemId: pen, description: "Pen", qtyMilli: 5_000, ratePaise: 600, batchNo: "B-2", expiryDate: "2027-06-01" }] }, 1);
    const batches = await batchStock(db, firmId, { today: "2026-09-20" });
    const b1 = batches.find((b) => b.batch_no === "B-1")!;
    expect(b1).toMatchObject({ qty_milli: 10_000, days_to_expiry: 42 });
    expect(batches.find((b) => b.batch_no === "B-2")!.qty_milli).toBe(5_000);
  });

  it("tracks a serial number from purchase to sale", async () => {
    await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-09-11", partyId: mala, lines: [{ itemId: phone, description: "Phone", qtyMilli: 2000, ratePaise: 800_000, serialNumbers: ["SN-1", "SN-2"] }] }, 1);
    let list = await serialReport(db, firmId, { itemId: phone });
    expect(list.map((s) => [s.serial, s.status])).toEqual([["SN-1", "in_stock"], ["SN-2", "in_stock"]]);
    await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-12", partyId: ravi, paidPaise: 1_180_000, lines: [{ itemId: phone, description: "Phone", qtyMilli: 1000, ratePaise: 1_000_000, taxRateId: gst18, serialNumbers: ["SN-1"] }] }, 1);
    list = await serialReport(db, firmId, { itemId: phone });
    expect(list.find((s) => s.serial === "SN-1")).toMatchObject({ status: "sold", party_name: "Ravi Stores" });
    expect(list.find((s) => s.serial === "SN-2")!.status).toBe("in_stock");
    expect((await serialReport(db, firmId, { q: "sn-2" })).length).toBe(1);
  });
});

describe("credit limit", () => {
  it("warns by default, blocks when set to block, and ignores customers with no limit", async () => {
    const big = await sale(ravi, "2026-09-15", 100, 1000);
    expect(big.warnings.join(" ")).toMatch(/credit limit/);
    await saveSettings(db, firmId, { creditLimitMode: "block" });
    await expect(sale(ravi, "2026-09-16", 10, 1000)).rejects.toThrow(/credit limit/);
    await expect(sale(mala, "2026-09-16", 10, 1000)).resolves.toBeTruthy();
    await saveSettings(db, firmId, { creditLimitMode: "off" });
    const off = await sale(ravi, "2026-09-17", 10, 1000);
    expect(off.warnings.join(" ")).not.toMatch(/credit limit/);
  });
});
