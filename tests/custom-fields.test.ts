import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, items } from "@/db/schema";
import { cleanCustomValues, listCustomFields, saveCustomField } from "@/server/custom-fields";
import { toXlsx, readTable } from "@/server/excel";
import { exportItems, importItems, itemColumns } from "@/server/imports";
import { loadInvoiceModel } from "@/server/invoice";
import { saveItem } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let brand: number;
let warranty: number;
let expiry: number;
let itemId: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  brand = await saveCustomField(db, firmId, { name: "Brand", kind: "text", showOnInvoice: true });
  warranty = await saveCustomField(db, firmId, { name: "Warranty (months)", kind: "number" });
  expiry = await saveCustomField(db, firmId, { name: "Best before", kind: "date" });
});

describe("custom item fields", () => {
  it("keeps unique names and lists fields in order", async () => {
    await expect(saveCustomField(db, firmId, { name: "brand" })).rejects.toThrow(/already exists/);
    expect((await listCustomFields(db, firmId)).map((f) => f.name)).toEqual(["Brand", "Warranty (months)", "Best before"]);
  });

  it("stores values on an item, checking each against its type and dropping unknown ones", async () => {
    itemId = await saveItem(db, firmId, { name: "Mixer", salePricePaise: 100_000, customValues: { [brand]: "Prestige", [warranty]: "24", [expiry]: "2027-01-31", "9999": "junk" } }, 1);
    const [row] = await db.select().from(items).where(eq(items.id, itemId));
    expect(row.customValues).toEqual({ [String(brand)]: "Prestige", [String(warranty)]: "24", [String(expiry)]: "2027-01-31" });
    await expect(saveItem(db, firmId, { name: "Bad", customValues: { [warranty]: "two years" } }, 1)).rejects.toThrow(/not a number/);
    await expect(saveItem(db, firmId, { name: "Bad2", customValues: { [expiry]: "31/01/2027" } }, 1)).rejects.toThrow(/valid date/);
    expect(await cleanCustomValues(db, firmId, { [brand]: "  " })).toEqual({});
  });

  it("a save without custom values leaves the existing ones alone", async () => {
    await saveItem(db, firmId, { id: itemId, name: "Mixer", salePricePaise: 120_000 }, 1);
    const [row] = await db.select().from(items).where(eq(items.id, itemId));
    expect(row.salePricePaise).toBe(120_000);
    expect(row.customValues[String(brand)]).toBe("Prestige");
  });

  it("round-trips through Excel, updating a value by column name", async () => {
    const custom = await listCustomFields(db, firmId, { activeOnly: true });
    const rows = await exportItems(db, firmId, custom);
    const cols = itemColumns({ purchase: true, custom });
    expect(cols.map((c) => c.header)).toEqual(expect.arrayContaining(["Brand", "Warranty (months)"]));
    const t = await readTable(await toXlsx("Items", cols, rows.map((r) => ({ ...r, [`cf:${brand}`]: "Bajaj" }))), "x.xlsx");
    const res = await importItems(db, firmId, t, 1, { dryRun: false, purchase: true });
    expect(res.errors).toEqual([]);
    const [row] = await db.select().from(items).where(eq(items.id, itemId));
    expect(row.customValues[String(brand)]).toBe("Bajaj");
    expect(row.customValues[String(warranty)]).toBe("24");
  });

  it("prints fields marked 'on invoice' under the item name", async () => {
    const v = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-20", paidPaise: 0, lines: [{ itemId, description: "Mixer", qtyMilli: 1000, ratePaise: 120_000 }] }, 1);
    const m = (await loadInvoiceModel(db, firmId, v.id))!;
    expect(m.lines[0].desc).toBe("Mixer\nBrand: Bajaj");
  });
});
