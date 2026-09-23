import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations, roles, stockLedger } from "@/db/schema";
import { saveSettings } from "@/lib/settings";
import { saveItem } from "@/server/masters";
import { stockSummary } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher, VoucherError } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let warehouseId: number;
let shopId: number;
let widget: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  const locs = await db.select().from(locations).where(eq(locations.firmId, firmId)).orderBy(asc(locations.sort));
  warehouseId = locs.find((l) => l.kind === "warehouse")!.id;
  shopId = locs.find((l) => l.kind === "shop")!.id;
  widget = await saveItem(db, firmId, { name: "Widget", salePricePaise: 2_000, purchasePricePaise: 1_000 }, 1);
});

async function stockAt(itemId: number, locationId: number): Promise<number> {
  const rows = await db.select().from(stockLedger).where(eq(stockLedger.itemId, itemId));
  return rows.filter((r) => r.locationId === locationId).reduce((s, r) => s + r.qtyMilli, 0);
}

describe("new company setup", () => {
  it("seeds a Warehouse and a Main shop", async () => {
    const locs = await db.select().from(locations).where(eq(locations.firmId, firmId));
    expect(locs.map((l) => [l.name, l.kind]).sort()).toEqual([
      ["Main shop", "shop"],
      ["Warehouse", "warehouse"],
    ]);
  });

  it("gives the Accountant role every shop by default", async () => {
    const [acct] = await db.select().from(roles).where(eq(roles.name, "Accountant"));
    expect(acct.permissions).toContain("locations.all");
  });
});

describe("per-location stock", () => {
  it("a purchase with no shop chosen defaults into the warehouse", async () => {
    await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-09-01", lines: [{ itemId: widget, description: "Widget", qtyMilli: 100_000, ratePaise: 1_000 }] }, 1);
    expect(await stockAt(widget, warehouseId)).toBe(100_000);
    expect(await stockAt(widget, shopId)).toBe(0);
  });

  it("a transfer moves stock from the warehouse to the shop at zero net value", async () => {
    await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-02", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 40_000, ratePaise: 0 }] }, 1);
    expect(await stockAt(widget, warehouseId)).toBe(60_000);
    expect(await stockAt(widget, shopId)).toBe(40_000);
  });

  it("a transfer needs two different shops", async () => {
    await expect(
      saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-02", locationId: warehouseId, toLocationId: warehouseId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 1_000, ratePaise: 0 }] }, 1),
    ).rejects.toThrow(VoucherError);
  });

  it("a sale at the shop reduces only the shop's stock, not the warehouse's", async () => {
    await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-03", locationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 10_000, ratePaise: 2_000 }] }, 1);
    expect(await stockAt(widget, shopId)).toBe(30_000);
    expect(await stockAt(widget, warehouseId)).toBe(60_000);
  });

  it("company-wide stock summary sums every location", async () => {
    const [row] = await stockSummary(db, firmId);
    expect(row.qty_milli).toBe(90_000); // 60,000 at the warehouse + 30,000 at the shop
  });

  it("blocks a sale that would take a shop's own stock negative, even though another shop has plenty", async () => {
    await saveSettings(db, firmId, { allowNegativeStock: false });
    await expect(
      saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-04", locationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 31_000, ratePaise: 2_000 }] }, 1),
    ).rejects.toThrow(/Not enough stock/);
    // The warehouse has 60,000 — plenty — so a sale for the same qty from there goes through.
    await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-04", locationId: warehouseId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 31_000, ratePaise: 2_000 }] }, 1);
    expect(await stockAt(widget, warehouseId)).toBe(29_000);
    await saveSettings(db, firmId, { allowNegativeStock: true });
  });
});
