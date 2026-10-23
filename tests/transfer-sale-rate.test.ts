import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { auditLog, firms, items, locations, voucherLines } from "@/db/schema";
import { saveItem, saveParty } from "@/server/masters";
import { stockValueAt } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { getVoucher, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let warehouseId: number;
let shopId: number;
let syrup: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Transfer Co", stateCode: "29", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" } as never);
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  const locs = await db.select().from(locations).where(eq(locations.firmId, firmId));
  warehouseId = locs.find((l) => l.kind === "warehouse")!.id;
  shopId = locs.find((l) => l.kind === "shop")!.id;
  syrup = await saveItem(db, firmId, { name: "Astha Aid Syrup", purchasePricePaise: 193_80, salePricePaise: 340_00 }, 1);
  // 10 bought into the warehouse at the purchase rate.
  const sup = await saveParty(db, firmId, { kind: "supplier", name: "S P Homoeo" }, 1);
  await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-10-20", partyId: sup, locationId: warehouseId, supplierInvoiceNo: "A1", lines: [{ itemId: syrup, description: "Astha Aid Syrup", qtyMilli: 10_000, ratePaise: 193_80 }] }, 1);
});

describe("a transfer from the warehouse to a shop", () => {
  it("goes at the item's sale rate, whatever rate was sent", async () => {
    const x = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-10-22", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: syrup, description: "Astha Aid Syrup", qtyMilli: 3_000, ratePaise: 193_80 }] }, 1);
    const data = (await getVoucher(db, firmId, x.id))!;
    expect(data.lines[0]).toMatchObject({ ratePaise: 340_00, salePricePaise: 340_00, totalPaise: 1020_00 });
    expect(data.voucher.totalPaise).toBe(1020_00);
  });

  it("follows the sale rate in force on the day: a later price change doesn't alter it", async () => {
    const x = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-10-22", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: syrup, description: "Astha Aid Syrup", qtyMilli: 1_000, ratePaise: 0 }] }, 1);
    await saveItem(db, firmId, { id: syrup, name: "Astha Aid Syrup", purchasePricePaise: 193_80, salePricePaise: 360_00 }, 1);
    const [line] = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, x.id));
    expect(line.ratePaise).toBe(340_00);
    await saveItem(db, firmId, { id: syrup, name: "Astha Aid Syrup", purchasePricePaise: 193_80, salePricePaise: 340_00 }, 1);
  });

  it("a free-text line (no item) keeps the rate typed", async () => {
    const x = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-10-22", locationId: warehouseId, toLocationId: shopId, lines: [{ description: "Carton of leaflets", qtyMilli: 1_000, ratePaise: 50_00 }] }, 1);
    const [line] = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, x.id));
    expect([line.ratePaise, line.salePricePaise]).toEqual([50_00, null]);
  });

  it("a sale rate edited on the transfer is saved to the item, so it shows everywhere", async () => {
    const x = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-10-22", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: syrup, description: "Astha Aid Syrup", qtyMilli: 2_000, ratePaise: 355_00 }], itemSalePrices: [{ itemId: syrup, salePricePaise: 355_00 }] }, 1);
    const [line] = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, x.id));
    expect([line.ratePaise, line.salePricePaise, line.totalPaise]).toEqual([355_00, 355_00, 710_00]);
    const [item] = await db.select().from(items).where(eq(items.id, syrup));
    expect(item.salePricePaise).toBe(355_00);
    const log = await db.select().from(auditLog).where(eq(auditLog.entity, "item"));
    expect(log.at(-1)!.summary).toMatch(/Sale price of Astha Aid Syrup changed from 340\.00 to 355\.00 \(on a stock transfer\)/);
    // The next transfer, with nothing typed, goes at the new price.
    const y = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-10-22", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: syrup, description: "Astha Aid Syrup", qtyMilli: 1_000, ratePaise: 0 }] }, 1);
    expect((await getVoucher(db, firmId, y.id))!.lines[0].ratePaise).toBe(355_00);
    await saveItem(db, firmId, { id: syrup, name: "Astha Aid Syrup", purchasePricePaise: 193_80, salePricePaise: 340_00 }, 1);
  });

  it("without the permission nothing is saved to the item: a typed rate is ignored", async () => {
    const x = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-10-22", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: syrup, description: "Astha Aid Syrup", qtyMilli: 1_000, ratePaise: 999_00 }] }, 1);
    expect((await getVoucher(db, firmId, x.id))!.lines[0].ratePaise).toBe(340_00);
    const [item] = await db.select().from(items).where(eq(items.id, syrup));
    expect(item.salePricePaise).toBe(340_00);
  });

  it("doesn't change the value of stock: that stays at the purchase rate", async () => {
    const before = await stockValueAt(db, firmId, "2026-10-21");
    const after = await stockValueAt(db, firmId, "2026-10-23");
    expect(before).toBe(10 * 193_80);
    expect(after).toBe(before);
  });
});
