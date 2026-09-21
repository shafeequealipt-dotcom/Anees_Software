import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { backupRequests, firms } from "@/db/schema";
import { backupOverview, requestBackup } from "@/server/backups";
import { deleteCategory, listAllCategories, saveCategoryName } from "@/server/categories";
import { saveItem } from "@/server/masters";
import { saveCategory } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
});

describe("category management", () => {
  it("adds, renames and lists item, expense and income categories separately", async () => {
    await saveCategoryName(db, firmId, "item", undefined, "Stationery", 1);
    await saveCategoryName(db, firmId, "expense", undefined, "Fuel", 1);
    await saveCategoryName(db, firmId, "income", undefined, "Scrap sales", 1);
    let all = await listAllCategories(db, firmId);
    expect(all.item.map((c) => c.name)).toEqual(["Stationery"]);
    expect(all.expense.map((c) => c.name)).toContain("Fuel");
    expect(all.income.map((c) => c.name)).toContain("Scrap sales");
    await saveCategoryName(db, firmId, "expense", all.expense.find((c) => c.name === "Fuel")!.id, "Petrol and diesel", 1);
    all = await listAllCategories(db, firmId);
    expect(all.expense.some((c) => c.name === "Petrol and diesel")).toBe(true);
    await expect(saveCategoryName(db, firmId, "item", undefined, "stationery", 1)).rejects.toThrow(/already exists/);
    await expect(saveCategoryName(db, firmId, "item", undefined, "  ", 1)).rejects.toThrow(/Enter a name/);
  });

  it("refuses to delete a category that is in use", async () => {
    const cat = await saveCategory(db, firmId, "Grocery");
    await saveItem(db, firmId, { name: "Rice", categoryId: cat, salePricePaise: 100 }, 1);
    await expect(deleteCategory(db, firmId, "item", cat, 1)).rejects.toThrow(/used on 1 item/);
    const exp = (await listAllCategories(db, firmId)).expense.find((c) => c.name === "Rent")!;
    await saveVoucher(db, firmId, { type: "expense", date: "2026-09-01", categoryId: exp.id, lines: [{ description: "Rent", qtyMilli: 1000, ratePaise: 100 }] }, 1);
    await expect(deleteCategory(db, firmId, "expense", exp.id, 1)).rejects.toThrow(/used on 1 bill/);
    const unused = (await listAllCategories(db, firmId)).expense.find((c) => c.name === "Travel")!;
    await deleteCategory(db, firmId, "expense", unused.id, 1);
    expect((await listAllCategories(db, firmId)).expense.some((c) => c.name === "Travel")).toBe(false);
  });
});

describe("backup requests", () => {
  it("allows one open request at a time and shows it in the overview", async () => {
    const id = await requestBackup(db, 1);
    await expect(requestBackup(db, 1)).rejects.toThrow(/already waiting/);
    let o = await backupOverview(db);
    expect(o.open).toBe(true);
    expect(o.requests[0]).toMatchObject({ id, status: "pending" });
    await db.update(backupRequests).set({ status: "done", finishedAt: new Date() }).where(eq(backupRequests.id, id));
    o = await backupOverview(db);
    expect(o.open).toBe(false);
    await expect(requestBackup(db, 1)).resolves.toBeTruthy();
  });
});
