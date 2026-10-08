import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, items, users } from "@/db/schema";
import { formatProductId, nextProductId, productLabel, sequenceNumber } from "@/lib/product-id";
import { saveSettings } from "@/lib/settings";
import { createCompany } from "@/server/admin";
import { exportAllData, restoreAllData } from "@/server/data-backup";
import { readTable, toXlsx } from "@/server/excel";
import { exportItems, importItems, itemColumns } from "@/server/imports";
import { loadInvoiceModel } from "@/server/invoice";
import { previewNextProductId, productIdSetup, saveItem } from "@/server/masters";
import { renderInvoicePdf } from "@/server/pdf/invoice-pdf";
import { itemSales, stockSummary } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { getVoucher, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let owner: { id: number; name: string; email: string };

const codeOf = async (id: number) => (await db.select({ code: items.code }).from(items).where(eq(items.id, id)))[0].code;
const add = (name: string, code?: string, firm = firmId) => saveItem(db, firm, { name, code }, 1);

async function sheet(headers: string[], rows: string[][]) {
  const cols = headers.map((h, i) => ({ header: h, key: `c${i}` }));
  const data = rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v])));
  return readTable(await toXlsx("S", cols, data), "x.xlsx");
}

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", country: "IN", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  [owner] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
});

describe("the numbering rule", () => {
  it("continues after the highest number in use", () => {
    expect(nextProductId([], { prefix: "", digits: 0 })).toBe("1");
    expect(nextProductId(["348", "9143", "512"], { prefix: "", digits: 0 })).toBe("9144");
  });

  it("ignores letter codes and barcode-length numbers", () => {
    expect(nextProductId(["9143", "MB332", "8901030865278"], { prefix: "", digits: 0 })).toBe("9144");
    expect(sequenceNumber("8901030865278", "")).toBeNull();
    expect(sequenceNumber("MB332", "")).toBeNull();
    expect(sequenceNumber("mb332", "MB")).toBe(332);
  });

  it("applies the prefix and the minimum number of digits", () => {
    expect(formatProductId(12, { prefix: "P-", digits: 4 })).toBe("P-0012");
    expect(nextProductId(["P-0012", "p-0040", "77"], { prefix: "P-", digits: 4 })).toBe("P-0041");
    expect(nextProductId(["9999"], { prefix: "", digits: 4 })).toBe("10000");
  });

  it("steps past an ID somebody typed by hand", () => {
    expect(nextProductId(["5", "0006"], { prefix: "", digits: 4 })).toBe("0007");
    expect(nextProductId(["A1", "a2"], { prefix: "A", digits: 0 })).toBe("A3");
  });

  it("writes a product as ID then name", () => {
    expect(productLabel("132", "iphone bag")).toBe("132 iphone bag");
    expect(productLabel("", "Delivery charge")).toBe("Delivery charge");
    expect(productLabel(null, "Delivery charge")).toBe("Delivery charge");
  });
});

describe("Automatic", () => {
  it("is how a new company starts, and gives each new product the next number", async () => {
    expect(await productIdSetup(db, firmId)).toEqual({ mode: "auto", next: "1" });
    const a = await add("Blue pen");
    const b = await add("Red pen");
    expect([await codeOf(a), await codeOf(b)]).toEqual(["1", "2"]);
  });

  it("accepts a typed ID and carries on from the highest number", async () => {
    const typed = await add("Stapler", "9143");
    expect(await codeOf(typed)).toBe("9143");
    expect(await previewNextProductId(db, firmId)).toBe("9144");
    expect(await codeOf(await add("Punch"))).toBe("9144");
  });

  it("is not thrown off by a letter code or a barcode typed as the ID", async () => {
    await add("Marker", "MB332");
    await add("Soap", "8901030865278");
    expect(await codeOf(await add("Glue"))).toBe("9145");
  });

  it("gives ten products saved at the same moment ten different IDs", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => add(`Rush item ${i}`)));
    const codes = await Promise.all(ids.map(codeOf));
    expect(new Set(codes).size).toBe(10);
    expect(codes.map(Number).sort((x, y) => x - y)).toEqual(Array.from({ length: 10 }, (_, i) => 9146 + i));
  });

  it("uses the prefix and digits from Settings, without touching existing IDs", async () => {
    const before = await db.select({ id: items.id, code: items.code }).from(items).where(eq(items.firmId, firmId));
    await saveSettings(db, firmId, { productIdPrefix: "P-", productIdDigits: 4 });
    expect(await previewNextProductId(db, firmId)).toBe("P-0001");
    expect(await codeOf(await add("Folder"))).toBe("P-0001");
    expect(await codeOf(await add("File"))).toBe("P-0002");
    for (const b of before) expect(await codeOf(b.id)).toBe(b.code);
    await saveSettings(db, firmId, { productIdPrefix: "", productIdDigits: 0 });
    expect(await previewNextProductId(db, firmId)).toBe("9156");
  });
});

describe("uniqueness and edits", () => {
  it("refuses an ID another product has, whatever the capitals", async () => {
    await expect(add("Other marker", "mb332")).rejects.toThrow(/Product ID "mb332" is already used by "Marker"/);
    await expect(add("Other pen", "1")).rejects.toThrow(/already used by "Blue pen"/);
  });

  it("the database itself refuses a case-only duplicate", async () => {
    await expect(db.insert(items).values({ firmId, name: "Sneaky", code: "Mb332" })).rejects.toThrow();
  });

  it("keeps the ID when an edit leaves it blank, and lets it be changed", async () => {
    const [pen] = await db.select().from(items).where(and(eq(items.firmId, firmId), eq(items.name, "Blue pen")));
    await saveItem(db, firmId, { id: pen.id, name: "Blue pen", salePricePaise: 1_500 }, 1);
    expect(await codeOf(pen.id)).toBe("1");
    await saveItem(db, firmId, { id: pen.id, name: "Blue pen", code: "" }, 1);
    expect(await codeOf(pen.id)).toBe("1");
    await saveItem(db, firmId, { id: pen.id, name: "Blue pen", code: "BP-1" }, 1);
    expect(await codeOf(pen.id)).toBe("BP-1");
    // Its own ID in different capitals is not a clash with itself.
    await saveItem(db, firmId, { id: pen.id, name: "Blue pen", code: "bp-1" }, 1);
    expect(await codeOf(pen.id)).toBe("bp-1");
    await saveItem(db, firmId, { id: pen.id, name: "Blue pen", code: "1" }, 1);
  });

  it("each company has its own IDs", async () => {
    const other = await createCompany(db, { name: "Pune Traders", country: "IN", taxId: "", stateCode: "27" }, { id: owner.id, isOwner: true, firms: [], permissions: [] });
    expect(await codeOf(await add("Blue pen", undefined, other))).toBe("1");
    expect(await codeOf(await add("Marker", "MB332", other))).toBe("MB332");
  });
});

describe("Choose your own", () => {
  it("insists on an ID for a new product and keeps the ones already given", async () => {
    const [glue] = await db.select().from(items).where(and(eq(items.firmId, firmId), eq(items.name, "Glue")));
    await saveSettings(db, firmId, { productIdMode: "manual" });
    await expect(add("Ruler")).rejects.toThrow(/Enter a Product ID/);
    expect(await codeOf(await add("Ruler", "RUL-30"))).toBe("RUL-30");
    expect(await codeOf(glue.id)).toBe("9145");
    await saveItem(db, firmId, { id: glue.id, name: "Glue", salePricePaise: 2_000 }, 1);
    expect(await codeOf(glue.id)).toBe("9145");

    await saveSettings(db, firmId, { productIdMode: "auto" });
    expect(await codeOf(await add("Eraser"))).toBe("9156");
  });
});

describe("where the ID shows", () => {
  it("is on every bill line, in front of the name on the printout, and follows a later change", async () => {
    const [glue] = await db.select().from(items).where(and(eq(items.firmId, firmId), eq(items.name, "Glue")));
    const v = await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-20", paidPaise: 0, lines: [{ itemId: glue.id, description: "Glue", qtyMilli: 1000, ratePaise: 2_000 }, { description: "Delivery", qtyMilli: 1000, ratePaise: 500 }] }, 1);

    const bill = (await getVoucher(db, firmId, v.id))!;
    expect(bill.lines.map((l) => l.itemCode)).toEqual(["9145", null]);

    let m = (await loadInvoiceModel(db, firmId, v.id))!;
    expect(m.lines.map((l) => [l.code, l.desc])).toEqual([["9145", "Glue"], ["", "Delivery"]]);
    expect(productLabel(m.lines[0].code, m.lines[0].desc)).toBe("9145 Glue");
    for (const paper of ["A4", "A5", "T80", "T58"] as const) {
      const pdf = await renderInvoicePdf((await loadInvoiceModel(db, firmId, v.id, { paper }))!);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }

    await saveItem(db, firmId, { id: glue.id, name: "Glue", code: "GL-7" }, 1);
    m = (await loadInvoiceModel(db, firmId, v.id))!;
    expect(m.lines[0].code).toBe("GL-7");
    await saveItem(db, firmId, { id: glue.id, name: "Glue", code: "9145" }, 1);
  });

  it("is in the sales and stock reports", async () => {
    const sold = await itemSales(db, firmId, "2026-09-01", "2026-09-30");
    expect(sold.find((r) => r.name === "Glue")?.code).toBe("9145");
    expect(sold.find((r) => r.name === "Delivery")?.code).toBeNull();
    const stock = await stockSummary(db, firmId, {});
    expect(stock.every((i) => !!i.code)).toBe(true);
  });
});

describe("Excel import", () => {
  it("uses the new headings, still reads the old ones, and numbers blank rows", async () => {
    const cols = itemColumns({ purchase: true }).map((c) => c.header);
    expect(cols.slice(0, 3)).toEqual(["Row ID (do not edit)", "Name", "Product ID"]);

    const t = await sheet(["Name", "Product ID", "Sale price"], [["Tape", "T-1", "30"], ["Clip", "", "5"]]);
    const res = await importItems(db, firmId, t, 1, { dryRun: false, purchase: true });
    expect(res).toMatchObject({ created: 2, errors: [] });
    const rows = await db.select().from(items).where(eq(items.firmId, firmId));
    expect(rows.find((i) => i.name === "Tape")!.code).toBe("T-1");
    expect(rows.find((i) => i.name === "Clip")!.code).toBe("9157");

    const old = await sheet(["Name", "Item code"], [["Pin", "PIN-9"]]);
    expect(await importItems(db, firmId, old, 1, { dryRun: false, purchase: true })).toMatchObject({ created: 1, errors: [] });
  });

  it("a full export imports back without changing any ID", async () => {
    const before = await db.select({ id: items.id, code: items.code }).from(items).where(eq(items.firmId, firmId));
    const t = await readTable(await toXlsx("Items", itemColumns({ purchase: true }), await exportItems(db, firmId, [])), "x.xlsx");
    const res = await importItems(db, firmId, t, 1, { dryRun: false, purchase: true });
    expect(res).toMatchObject({ created: 0, updated: before.length, errors: [] });
    for (const b of before) expect(await codeOf(b.id)).toBe(b.code);
  });

  it("in Choose your own, a new row without an ID is reported, not guessed", async () => {
    await saveSettings(db, firmId, { productIdMode: "manual" });
    const t = await sheet(["Name", "Product ID"], [["Board", ""], ["Chalk", "CH-1"]]);
    const res = await importItems(db, firmId, t, 1, { dryRun: false, purchase: true });
    expect(res.created).toBe(1);
    expect(res.errors).toEqual([{ line: 2, message: "Enter a Product ID for this product." }]);
    await saveSettings(db, firmId, { productIdMode: "auto" });
  });
});

describe("restoring an older backup", () => {
  async function backupWith(change: (code: { value: unknown }, name: string) => void) {
    const { buffer } = await exportAllData(db, [firmId], owner);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("items")!;
    const head = (ws.getRow(1).values as unknown[]).map(String);
    const [codeCol, nameCol] = [head.indexOf("code"), head.indexOf("name")];
    for (let r = 2; r <= ws.rowCount; r++) change(ws.getRow(r).getCell(codeCol), String(ws.getRow(r).getCell(nameCol).value));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("gives products that had no ID the next numbers and leaves the rest alone", async () => {
    const buf = await backupWith((code, name) => {
      if (name === "Tape" || name === "Pin") code.value = null;
    });
    const res = await restoreAllData(db, buf, { id: owner.id, isOwner: true });
    const rows = await db.select().from(items).where(eq(items.firmId, res.companies[0].id));
    expect(rows.every((i) => i.code.trim() !== "")).toBe(true);
    expect(new Set(rows.map((i) => i.code.toLowerCase())).size).toBe(rows.length);
    expect(rows.filter((i) => ["Tape", "Pin"].includes(i.name)).map((i) => i.code).sort()).toEqual(["9158", "9159"]);
    expect(rows.find((i) => i.name === "Marker")!.code).toBe("MB332");
  });

  it("stops, naming both products, when two share an ID", async () => {
    const buf = await backupWith((code, name) => {
      if (name === "Tape") code.value = "mb332";
    });
    await expect(restoreAllData(db, buf, { id: owner.id, isOwner: true })).rejects.toThrow(/Product ID "mb332" is on two products.*"Marker" and "Tape"/);
  });
});

describe("the upgrade (migration 0022)", () => {
  it("numbers products that had no ID after the company's highest, and changes nothing else", async () => {
    const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((e) => e.tag);
    const at = tags.findIndex((t) => t.startsWith("0022_"));
    expect(at).toBeGreaterThan(0);
    const run = async (pg: PGlite, tag: string) => {
      for (const stmt of fs.readFileSync(path.join(process.cwd(), "drizzle", `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
    };
    const pg = new PGlite();
    for (const tag of tags.slice(0, at)) await run(pg, tag);

    // The live shape: numbers 348…9143, two letter codes, one product with nothing, one with spaces;
    // a second company with only blanks, and a pair that differs only by capitals.
    await pg.exec(`insert into firms (id, name) values (1, 'Shop'), (2, 'Other'), (3, 'Empty');
      insert into items (id, firm_id, name, code) values
        (1, 1, 'A', '348'), (2, 1, 'B', '9143'), (3, 1, 'C', 'MB332'), (4, 1, 'D', 'MB453'), (5, 1, 'OPONE', null), (6, 1, 'Spaces', '   '),
        (7, 1, 'Barcode', '8901030865278'), (8, 1, 'ab', 'ab-1'), (9, 1, 'AB', 'AB-1'),
        (10, 2, 'X', null), (11, 2, 'Y', null);`);
    await run(pg, tags[at]);

    const rows = (await pg.query<{ id: number; code: string }>("select id, code from items order by id")).rows;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.code]))).toEqual({ 1: "348", 2: "9143", 3: "MB332", 4: "MB453", 5: "9144", 6: "9145", 7: "8901030865278", 8: "ab-1", 9: "AB-1-9", 10: "1", 11: "2" });
    await expect(pg.exec("insert into items (firm_id, name, code) values (1, 'Dupe', 'mb332')")).rejects.toThrow();
    await expect(pg.exec("insert into items (firm_id, name) values (1, 'Blank')")).rejects.toThrow();
    await pg.close();
  });
});
