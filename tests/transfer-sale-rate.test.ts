import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations, voucherLines } from "@/db/schema";
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

  it("doesn't change the value of stock: that stays at the purchase rate", async () => {
    const before = await stockValueAt(db, firmId, "2026-10-21");
    const after = await stockValueAt(db, firmId, "2026-10-23");
    expect(before).toBe(10 * 193_80);
    expect(after).toBe(before);
  });
});
