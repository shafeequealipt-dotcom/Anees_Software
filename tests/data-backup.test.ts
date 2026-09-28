import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations } from "@/db/schema";
import { createUser, listRoles } from "@/server/admin";
import { saveItem, saveParty } from "@/server/masters";
import { BACKUP_FORMAT, BACKUP_TABLES, countRows, exportAllData, inspectBackup, restoreAllData } from "@/server/data-backup";
import { dashboard, dayBook, partyBalances, stockSummary } from "@/server/reports";
import { cancelVoucher, deleteVoucher, listDeletedVouchers, restoreVoucher, saveVoucher } from "@/server/vouchers";
import { runFirstSetup } from "@/server/setup";
import { userFirms } from "@/db/schema";
import { testDb } from "./helpers/db";

const owner = { id: 1, name: "Owner", email: "o@t.example" };

let db: DB;
let firmId: number;
let warehouseId: number;
let widgetId: number;
let partyId: number;
let deletedVoucherId: number;
let staffId: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Backup Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  warehouseId = (await db.select().from(locations).where(eq(locations.firmId, firmId)).orderBy(asc(locations.sort)))[0].id;
  const staffRole = (await listRoles(db)).find((r) => r.name === "Billing staff")!.id;
  staffId = await createUser(db, { name: "Staff", email: "staff@t.example", roleId: staffRole, password: "Tulsi-Garden-4471", firmIds: [firmId] } as never, owner.id);

  widgetId = await saveItem(db, firmId, { name: "Widget", salePricePaise: 2_000, purchasePricePaise: 1_000, minStockMilli: 5_000 }, owner.id);
  partyId = await saveParty(db, firmId, { name: "Acme Retail", kind: "customer", openingBalancePaise: 10_000 }, owner.id);

  await saveVoucher(db, firmId, { type: "purchase_bill", date: "2026-04-05", locationId: warehouseId, lines: [{ itemId: widgetId, description: "Widget", qtyMilli: 100_000, ratePaise: 1_000 }] }, owner.id);
  const sale = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-04-10", partyId, locationId: warehouseId, lines: [{ itemId: widgetId, description: "Widget", qtyMilli: 10_000, ratePaise: 2_000 }], paidPaise: 5_000 }, owner.id);
  const cancelMe = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-04-11", partyId, locationId: warehouseId, lines: [{ itemId: widgetId, description: "Widget", qtyMilli: 1_000, ratePaise: 2_000 }] }, owner.id);
  await cancelVoucher(db, firmId, cancelMe.id, owner.id);
  const toDelete = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-04-12", partyId, locationId: warehouseId, lines: [{ itemId: widgetId, description: "Widget", qtyMilli: 1_000, ratePaise: 2_000 }] }, owner.id);
  deletedVoucherId = toDelete.id;
  await deleteVoucher(db, firmId, deletedVoucherId, owner.id);
  void sale;
});

describe("export", () => {
  it("covers every backed-up table and validates as its own format", async () => {
    const { buffer, companies, rows } = await exportAllData(db, [firmId], owner);
    expect(companies).toEqual(["Backup Traders"]);
    expect(rows).toBeGreaterThan(0);
    const info = await inspectBackup(buffer);
    expect(info.companies).toEqual(["Backup Traders"]);
    expect(BACKUP_TABLES).toContain("vouchers");
    expect(BACKUP_TABLES).toContain("stock_ledger");
  });

  it(`stamps the file with the ${BACKUP_FORMAT} format`, async () => {
    const { buffer } = await exportAllData(db, [firmId], owner);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const info = wb.getWorksheet("Backup info");
    const values = info!.getSheetValues().flat().map(String);
    expect(values).toContain(BACKUP_FORMAT);
  });
});

describe("round trip", () => {
  it("restores as a new, separate company that matches the original", async () => {
    const before = await countRows(db, [firmId]);
    const { buffer } = await exportAllData(db, [firmId], owner);

    const result = await restoreAllData(db, buffer, { id: owner.id, isOwner: true });
    expect(result.companies).toHaveLength(1);
    const newFirmId = result.companies[0].id;
    expect(newFirmId).not.toBe(firmId);
    expect(result.companies[0].name).toMatch(/^Backup Traders \(restored /);

    // Row counts match, table for table — except audit_log, which gets exactly one new row on the
    // restored company: the "Restored company ..." entry the restore itself writes.
    const after = await countRows(db, [newFirmId]);
    expect(after).toEqual({ ...before, audit_log: before.audit_log + 1 });

    // The original company is untouched.
    const originalAfter = await countRows(db, [firmId]);
    expect(originalAfter).toEqual(before);

    // Business numbers agree between the two companies.
    const [origParties, newParties] = await Promise.all([partyBalances(db, firmId), partyBalances(db, newFirmId)]);
    expect(newParties.map((p) => [p.name, p.balance_paise])).toEqual(origParties.map((p) => [p.name, p.balance_paise]));

    const [origStock, newStock] = await Promise.all([stockSummary(db, firmId), stockSummary(db, newFirmId)]);
    expect(newStock.map((r) => [r.name, r.qty_milli])).toEqual(origStock.map((r) => [r.name, r.qty_milli]));

    const [origDay, newDay] = await Promise.all([dayBook(db, firmId, "2026-04-01", "2026-04-30"), dayBook(db, newFirmId, "2026-04-01", "2026-04-30")]);
    expect(newDay.map((v) => [v.type, v.total_paise, v.status])).toEqual(origDay.map((v) => [v.type, v.total_paise, v.status]));

    const [origDash, newDash] = await Promise.all([dashboard(db, firmId), dashboard(db, newFirmId)]);
    expect(newDash.receivable).toBe(origDash.receivable);

    // Cancelled and deleted bills carried over with their status and number intact.
    const origDeleted = await listDeletedVouchers(db, firmId);
    const newDeleted = await listDeletedVouchers(db, newFirmId);
    expect(newDeleted.map((v) => [v.type, v.number, v.totalPaise])).toEqual(origDeleted.map((v) => [v.type, v.number, v.totalPaise]));
    const origRow = origDeleted.find((v) => v.id === deletedVoucherId)!;

    // The restored copy's own deleted bill can still be brought back from its snapshot.
    const target = newDeleted.find((v) => v.number === origRow.number)!;
    await expect(restoreVoucher(db, newFirmId, target.id, owner.id)).resolves.toMatchObject({ type: "sale_invoice" });
  });

  it("gives a non-owner restorer access to the company they just restored, without touching other users", async () => {
    const { buffer } = await exportAllData(db, [firmId], owner);
    const before = await db.select().from(userFirms).where(eq(userFirms.userId, staffId));

    const result = await restoreAllData(db, buffer, { id: staffId, isOwner: false });
    expect(result.companies).toHaveLength(1);

    const after = await db.select().from(userFirms).where(eq(userFirms.userId, staffId));
    expect(after.length).toBe(before.length + 1);
    expect(after.some((r) => r.firmId === result.companies[0].id)).toBe(true);
  });
});

describe("bad files are refused without writing anything", () => {
  it("rejects a workbook with no Backup info sheet", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("nothing");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const before = await countRows(db, [firmId]);
    await expect(restoreAllData(db, buf, { id: owner.id, isOwner: true })).rejects.toThrow(/isn't a backup/);
    expect(await countRows(db, [firmId])).toEqual(before);
  });

  it("rejects a file whose row count was tampered with after export", async () => {
    const { buffer } = await exportAllData(db, [firmId], owner);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("parties")!;
    ws.addRow(ws.getRow(2).values as unknown[]); // a duplicate of a real row: valid data, but one extra row vs. the recorded count
    const tampered = Buffer.from(await wb.xlsx.writeBuffer());

    const firmsBefore = (await db.select({ id: firms.id }).from(firms)).length;
    await expect(restoreAllData(db, tampered, { id: owner.id, isOwner: true })).rejects.toThrow(/changed after it was downloaded/);
    expect((await db.select({ id: firms.id }).from(firms)).length).toBe(firmsBefore);
  });
});
