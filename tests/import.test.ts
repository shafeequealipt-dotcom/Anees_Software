import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, items, parties } from "@/db/schema";
import { toXlsx, readTable } from "@/server/excel";
import { exportItems, importItems, importParties, itemColumns, partyColumns } from "@/server/imports";
import { runFirstSetup } from "@/server/setup";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;

async function sheet(headers: string[], rows: string[][]) {
  const cols = headers.map((h, i) => ({ header: h, key: `c${i}` }));
  const data = rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v])));
  return readTable(await toXlsx("S", cols, data), "x.xlsx");
}

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", country: "IN", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
});

describe("Excel import", () => {
  it("checks parties without saving, then imports them", async () => {
    const t = await sheet(["Name", "Type", "Phone", "State", "Opening balance", "Balance type", "Group"], [
      ["Ravi Stores", "Customer", "9876543210", "Maharashtra", "5000", "To receive", "Retailers"],
      ["Paper Mills", "Supplier", "", "27", "1200.50", "To pay", ""],
      ["", "Customer", "", "", "", "", ""],
      ["Bad State Co", "Customer", "", "Atlantis", "", "", ""],
    ]);
    const dry = await importParties(db, firmId, t, 1, true);
    expect(dry).toMatchObject({ total: 4, created: 2, dryRun: true });
    expect(dry.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(await db.select().from(parties)).toHaveLength(0);

    const real = await importParties(db, firmId, t, 1, false);
    expect(real.created).toBe(2);
    const rows = await db.select().from(parties).where(eq(parties.firmId, firmId));
    expect(rows.find((p) => p.name === "Ravi Stores")).toMatchObject({ kind: "customer", stateCode: "27", openingBalancePaise: 500_000 });
    expect(rows.find((p) => p.name === "Paper Mills")).toMatchObject({ kind: "supplier", openingBalancePaise: -120_050 });

    const again = await importParties(db, firmId, t, 1, false);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(2);
  });

  it("adds items, creating unit and category, and rejects an unknown tax rate", async () => {
    const t = await sheet(["Name", "Item code", "Unit", "Category", "Sale price", "Purchase price", "GST rate %", "Opening stock"], [
      ["Blue pen", "PEN-01", "PCS", "Stationery", "10", "6", "18", "100"],
      ["Odd tax item", "ODD", "PCS", "", "10", "", "13", ""],
      ["Loose tea", "TEA", "Bundle", "Grocery", "250", "180", "5", ""],
    ]);
    const res = await importItems(db, firmId, t, 1, { dryRun: false, purchase: true });
    expect(res.created).toBe(2);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/13%|"13"/);
    const pen = (await db.select().from(items).where(eq(items.code, "PEN-01")))[0];
    expect(pen).toMatchObject({ salePricePaise: 1000, purchasePricePaise: 600, openingQtyMilli: 100_000 });
    expect(pen.unitId).not.toBeNull();
    expect(pen.categoryId).not.toBeNull();
  });

  it("bulk-updates by ID, leaving blank cells untouched", async () => {
    const pen = (await db.select().from(items).where(eq(items.code, "PEN-01")))[0];
    const t = await sheet(["ID", "Sale price", "Purchase price", "Low-stock alert"], [[String(pen.id), "12.50", "", "20"]]);
    const res = await importItems(db, firmId, t, 1, { dryRun: false, purchase: true });
    expect(res).toMatchObject({ updated: 1, created: 0 });
    const after = (await db.select().from(items).where(eq(items.id, pen.id)))[0];
    expect(after).toMatchObject({ salePricePaise: 1250, purchasePricePaise: 600, minStockMilli: 20_000, name: "Blue pen", openingQtyMilli: 100_000 });
  });

  it("ignores purchase columns for a user who may not see purchase prices", async () => {
    const pen = (await db.select().from(items).where(eq(items.code, "PEN-01")))[0];
    const t = await sheet(["ID", "Purchase price"], [[String(pen.id), "999"]]);
    await importItems(db, firmId, t, 1, { dryRun: false, purchase: false });
    expect((await db.select().from(items).where(eq(items.id, pen.id)))[0].purchasePricePaise).toBe(600);
  });

  it("refuses an ID from another company", async () => {
    const t = await sheet(["ID", "Sale price"], [["99999", "1"]]);
    const res = await importItems(db, firmId, t, 1, { dryRun: true, purchase: true });
    expect(res.errors[0].message).toMatch(/doesn't belong/);
  });

  it("exports what it can re-import, hiding purchase columns when not allowed", async () => {
    expect(itemColumns({ purchase: false }).some((c) => c.key === "purchase")).toBe(false);
    expect(partyColumns({ contact: false, balance: false }).map((c) => c.key)).toEqual(["name", "type", "group"]);
    const rows = await exportItems(db, firmId);
    const t = await readTable(await toXlsx("Items", itemColumns({ purchase: true }), rows), "items.xlsx");
    const res = await importItems(db, firmId, t, 1, { dryRun: true, purchase: true });
    expect(res.errors).toEqual([]);
    expect(res.updated).toBe(rows.length);
  });
});
