import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations, vouchers } from "@/db/schema";
import { saveItem, saveParty } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let shopId: number;
let widget: number;
let customer: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  const locs = await db.select().from(locations).where(eq(locations.firmId, firmId));
  shopId = locs.find((l) => l.kind === "shop")!.id;
  widget = await saveItem(db, firmId, { name: "Widget", salePricePaise: 1_000, purchasePricePaise: 500 }, 1);
  customer = await saveParty(db, firmId, { kind: "customer", name: "Cust One" }, 1);
});

describe("sale returns", () => {
  it("a return can't exceed what was sold", async () => {
    const sale = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-01", locationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 10_000, ratePaise: 1_000 }] }, 1);
    await expect(
      saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-02", sourceVoucherId: sale.id, lines: [{ itemId: widget, description: "Widget", qtyMilli: 11_000, ratePaise: 1_000 }] }, 1),
    ).rejects.toThrow(/Only 10 of "Widget" can still be returned/);
  });

  it("returns default to the shop the sale was from, and count against later returns", async () => {
    const sale = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-01", locationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 10_000, ratePaise: 1_000 }] }, 1);
    const ret1 = await saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-02", sourceVoucherId: sale.id, returnReason: "damaged", lines: [{ itemId: widget, description: "Widget", qtyMilli: 4_000, ratePaise: 1_000 }] }, 1);
    const [saved1] = await db.select().from(vouchers).where(eq(vouchers.id, ret1.id));
    expect(saved1.locationId).toBe(shopId);
    expect(saved1.returnReason).toBe("damaged");

    // 6 left; asking for 7 is rejected, mentioning the 4 already returned.
    await expect(
      saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-03", sourceVoucherId: sale.id, lines: [{ itemId: widget, description: "Widget", qtyMilli: 7_000, ratePaise: 1_000 }] }, 1),
    ).rejects.toThrow(/Only 6 of "Widget" can still be returned \(4 already returned\)/);

    // Exactly 6 goes through, fully exhausting the sale.
    await saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-03", sourceVoucherId: sale.id, lines: [{ itemId: widget, description: "Widget", qtyMilli: 6_000, ratePaise: 1_000 }] }, 1);
    await expect(
      saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-04", sourceVoucherId: sale.id, lines: [{ itemId: widget, description: "Widget", qtyMilli: 1_000, ratePaise: 1_000 }] }, 1),
    ).rejects.toThrow(/already been fully returned/);
  });

  it("editing a return excludes itself from the already-returned total", async () => {
    const sale = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-05", locationId: shopId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 5_000, ratePaise: 1_000 }] }, 1);
    const ret = await saveVoucher(db, firmId, { type: "credit_note", date: "2026-09-05", sourceVoucherId: sale.id, lines: [{ itemId: widget, description: "Widget", qtyMilli: 2_000, ratePaise: 1_000 }] }, 1);
    // Editing the same return up to the full 5 should be allowed (it doesn't double-count against itself).
    await expect(
      saveVoucher(db, firmId, { id: ret.id, type: "credit_note", date: "2026-09-05", sourceVoucherId: sale.id, lines: [{ itemId: widget, description: "Widget", qtyMilli: 5_000, ratePaise: 1_000 }] }, 1),
    ).resolves.toBeDefined();
  });
});

describe("payments and expenses carry a shop", () => {
  it("a payment_in without an explicit shop still gets a default location", async () => {
    const pay = await saveVoucher(db, firmId, { type: "payment_in", date: "2026-09-01", partyId: customer, amountPaise: 500 }, 1);
    const [saved] = await db.select().from(vouchers).where(eq(vouchers.id, pay.id));
    expect(saved.locationId).not.toBeNull();
  });
});
