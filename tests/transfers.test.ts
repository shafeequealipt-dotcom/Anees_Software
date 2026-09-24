import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations, stockLedger, voucherLines, vouchers } from "@/db/schema";
import { saveItem } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { cancelVoucher, receiveTransfer, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let warehouseId: number;
let shopId: number;
let transitId: number;
let damagedId: number;
let widget: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  const locs = await db.select().from(locations).where(eq(locations.firmId, firmId));
  warehouseId = locs.find((l) => l.kind === "warehouse")!.id;
  shopId = locs.find((l) => l.kind === "shop")!.id;
  transitId = locs.find((l) => l.kind === "transit")!.id;
  damagedId = locs.find((l) => l.kind === "damaged")!.id;
  widget = await saveItem(db, firmId, { name: "Widget", salePricePaise: 2_000, purchasePricePaise: 1_000 }, 1);
  await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-09-01", locationId: warehouseId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 1_000_000, ratePaise: 1_000 }] }, 1);
});

async function stockAt(itemId: number, locationId: number): Promise<number> {
  const rows = await db.select().from(stockLedger).where(eq(stockLedger.itemId, itemId));
  return rows.filter((r) => r.locationId === locationId).reduce((s, r) => s + r.qtyMilli, 0);
}

async function firstLine(voucherId: number) {
  const [l] = await db.select().from(voucherLines).where(eq(voucherLines.voucherId, voucherId));
  return l;
}

describe("sending a transfer", () => {
  it("moves stock out of the sender and into transit, and is visible as not yet received", async () => {
    const before = { wh: await stockAt(widget, warehouseId), transit: await stockAt(widget, transitId) };
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-02", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 100_000, ratePaise: 0 }] }, 1);
    expect(await stockAt(widget, warehouseId)).toBe(before.wh - 100_000);
    expect(await stockAt(widget, transitId)).toBe(before.transit + 100_000);
    const [saved] = await db.select().from(vouchers).where(eq(vouchers.id, xfer.id));
    expect(saved.receivedAt).toBeNull();
  });

  it("a sender can't send more than they have (when negative stock is disallowed)", async () => {
    const { saveSettings } = await import("@/lib/settings");
    await saveSettings(db, firmId, { allowNegativeStock: false });
    await expect(
      saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-02", locationId: shopId, toLocationId: warehouseId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 999_999_000, ratePaise: 0 }] }, 1),
    ).rejects.toThrow(/Not enough stock/);
    await saveSettings(db, firmId, { allowNegativeStock: true });
  });
});

describe("receiving a transfer", () => {
  it("a full, undamaged receipt moves everything from transit to the destination", async () => {
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-03", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 50_000, ratePaise: 0 }] }, 1);
    const line = await firstLine(xfer.id);
    const before = { transit: await stockAt(widget, transitId), shop: await stockAt(widget, shopId) };
    await receiveTransfer(db, firmId, xfer.id, 1, [{ lineId: line.id, receivedQtyMilli: 50_000, damagedQtyMilli: 0 }], null);
    expect(await stockAt(widget, transitId)).toBe(before.transit - 50_000);
    expect(await stockAt(widget, shopId)).toBe(before.shop + 50_000);
    const [saved] = await db.select().from(vouchers).where(eq(vouchers.id, xfer.id));
    expect(saved.receivedAt).not.toBeNull();
    expect(saved.receivedBy).toBe(1);
  });

  it("a partial receipt with damage splits into destination, damaged, and an unrecorded shortage", async () => {
    // Send 100: 70 arrive fine, 20 are damaged, 10 are simply missing.
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-04", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 100_000, ratePaise: 0 }] }, 1);
    const line = await firstLine(xfer.id);
    const before = { transit: await stockAt(widget, transitId), shop: await stockAt(widget, shopId), damaged: await stockAt(widget, damagedId) };
    const totalBefore = before.transit + before.shop + before.damaged + (await stockAt(widget, warehouseId));

    await receiveTransfer(db, firmId, xfer.id, 1, [{ lineId: line.id, receivedQtyMilli: 70_000, damagedQtyMilli: 20_000 }], "10 went missing in the van");

    expect(await stockAt(widget, transitId)).toBe(before.transit - 100_000); // the full sent amount leaves transit
    expect(await stockAt(widget, shopId)).toBe(before.shop + 70_000);
    expect(await stockAt(widget, damagedId)).toBe(before.damaged + 20_000);
    const totalAfter = (await stockAt(widget, transitId)) + (await stockAt(widget, shopId)) + (await stockAt(widget, damagedId)) + (await stockAt(widget, warehouseId));
    expect(totalAfter).toBe(totalBefore - 10_000); // the 10 short are a real, permanent loss

    const [saved] = await db.select().from(vouchers).where(eq(vouchers.id, xfer.id));
    expect(saved.notes).toContain("10 went missing in the van");
    const [savedLine] = await db.select().from(voucherLines).where(eq(voucherLines.id, line.id));
    expect(savedLine.receivedQtyMilli).toBe(70_000);
    expect(savedLine.damagedQtyMilli).toBe(20_000);
  });

  it("can't receive more than was sent", async () => {
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-05", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 10_000, ratePaise: 0 }] }, 1);
    const line = await firstLine(xfer.id);
    await expect(receiveTransfer(db, firmId, xfer.id, 1, [{ lineId: line.id, receivedQtyMilli: 8_000, damagedQtyMilli: 5_000 }], null)).rejects.toThrow(/more than the/);
  });

  it("can't receive the same transfer twice", async () => {
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-05", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 10_000, ratePaise: 0 }] }, 1);
    const line = await firstLine(xfer.id);
    await receiveTransfer(db, firmId, xfer.id, 1, [{ lineId: line.id, receivedQtyMilli: 10_000, damagedQtyMilli: 0 }], null);
    await expect(receiveTransfer(db, firmId, xfer.id, 1, [{ lineId: line.id, receivedQtyMilli: 10_000, damagedQtyMilli: 0 }], null)).rejects.toThrow(/already been received/);
  });
});

describe("editing and cancelling", () => {
  it("a received transfer can't be edited", async () => {
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-06", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 5_000, ratePaise: 0 }] }, 1);
    const line = await firstLine(xfer.id);
    await receiveTransfer(db, firmId, xfer.id, 1, [{ lineId: line.id, receivedQtyMilli: 5_000, damagedQtyMilli: 0 }], null);
    await expect(
      saveVoucher(db, firmId, { id: xfer.id, type: "stock_transfer", date: "2026-09-06", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 1_000, ratePaise: 0 }] }, 1),
    ).rejects.toThrow(/already been received/);
  });

  it("cancelling an in-transit transfer returns the stock to the sender", async () => {
    const before = { wh: await stockAt(widget, warehouseId), transit: await stockAt(widget, transitId) };
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-07", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 20_000, ratePaise: 0 }] }, 1);
    expect(await stockAt(widget, warehouseId)).toBe(before.wh - 20_000);
    expect(await stockAt(widget, transitId)).toBe(before.transit + 20_000);
    await cancelVoucher(db, firmId, xfer.id, 1);
    expect(await stockAt(widget, warehouseId)).toBe(before.wh);
    expect(await stockAt(widget, transitId)).toBe(before.transit);
  });

  it("cancelling an already-received transfer reverses both legs", async () => {
    const before = { wh: await stockAt(widget, warehouseId), shop: await stockAt(widget, shopId), transit: await stockAt(widget, transitId) };
    const xfer = await saveVoucher(db, firmId, { type: "stock_transfer", date: "2026-09-08", locationId: warehouseId, toLocationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 15_000, ratePaise: 0 }] }, 1);
    const line = await firstLine(xfer.id);
    await receiveTransfer(db, firmId, xfer.id, 1, [{ lineId: line.id, receivedQtyMilli: 15_000, damagedQtyMilli: 0 }], null);
    expect(await stockAt(widget, shopId)).toBe(before.shop + 15_000);
    await cancelVoucher(db, firmId, xfer.id, 1);
    expect(await stockAt(widget, warehouseId)).toBe(before.wh);
    expect(await stockAt(widget, shopId)).toBe(before.shop);
    expect(await stockAt(widget, transitId)).toBe(before.transit);
  });
});
