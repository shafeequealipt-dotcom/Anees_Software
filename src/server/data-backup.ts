import "server-only";
import ExcelJS from "exceljs";
import { asc, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DB, Tx } from "@/db";
import * as s from "@/db/schema";
import { audit } from "@/lib/audit";
import { nextProductId } from "@/lib/product-id";
import { MasterError } from "./errors";

/*
 * One Excel file holding every business record of one or more companies, one sheet per table,
 * restorable as brand-new companies. Rows are copied exactly (bill numbers, statuses, ledgers),
 * not re-entered, and get fresh IDs on restore; every ID that points at another row — foreign keys
 * and the few IDs hidden inside JSON or text keys — is rewritten to the new ones.
 *
 * When a table or ID-holding column is added to the schema, add it here too: the round-trip test
 * fails for any business table this list leaves out.
 */

export const BACKUP_FORMAT = "anees-billing-data";
export const BACKUP_VERSION = 1;
const INFO_SHEET = "Backup info";
const LONG_SHEET = "_long_values";
/** Excel refuses cells longer than 32,767 characters; longer text is split into LONG_SHEET. */
const CELL_LIMIT = 32_000;
const LONG_MARKER = "⟪see _long_values⟫";

type Ids = number[];
type Row = Record<string, unknown>;

class Remap {
  private maps = new Map<string, Map<number, number>>();
  set(table: string, m: Map<number, number>) {
    this.maps.set(table, m);
  }
  /** Old ID → new ID; a missing ID means the file is inconsistent, so the whole restore stops. */
  get(table: string, old: number, where: string): number {
    const id = this.maps.get(table)?.get(old);
    if (id === undefined) throw new MasterError(`${where} points to ${table} #${old}, which isn't in the backup file. The file may have been edited or is damaged.`);
    return id;
  }
  /** For IDs without a database constraint (history, links): unknown ones become empty rather than stopping the restore. */
  soft(table: string, old: unknown): number | null {
    if (old === null || old === undefined) return null;
    return this.maps.get(table)?.get(Number(old)) ?? null;
  }
}

interface Spec {
  /** Sheet name and table name. */
  key: string;
  table: PgTable;
  /** The table has a serial `id` that gets fresh values on restore. */
  id?: boolean;
  /** Foreign-key columns (property name) → the spec key they point to. */
  refs?: Record<string, string>;
  /** Columns holding a user ID: exported alongside the user's email, restored to the user with that email here. */
  users?: string[];
  /** Columns that never leave the server (secrets, keys). */
  omit?: string[];
  /** This table's rows for the given companies. */
  where: (firmIds: Ids) => SQL;
  /** IDs hidden in values (JSON, text keys, links without a constraint). Runs on restore after `refs`. */
  fix?: (row: Row, m: Remap) => void;
}

const list = (ids: Ids) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
const byFirm = (col: PgColumn) => (ids: Ids) => inArray(col, ids);
const firmVouchers = (col: PgColumn) => (ids: Ids) => sql`${col} in (select id from vouchers where firm_id in (${list(ids)}))`;
const firmItems = (col: PgColumn) => (ids: Ids) => sql`${col} in (select id from items where firm_id in (${list(ids)}))`;
const firmParties = (col: PgColumn) => (ids: Ids) => sql`${col} in (select id from parties where firm_id in (${list(ids)}))`;
const firmAccounts = (col: PgColumn) => (ids: Ids) => sql`${col} in (select id from accounts where firm_id in (${list(ids)}))`;

/** Text keys like "money:12", "party:4" or "asset:3:dep:2026-04-01" name a row by ID. */
const KEY_TABLES: Record<string, string> = { money: "accounts", account: "accounts", cat: "ledger_categories", item: "items", party: "parties", asset: "fixed_assets" };
function fixKey(v: unknown, m: Remap): unknown {
  if (typeof v !== "string") return v;
  const hit = /^([a-z]+):(\d+)(.*)$/.exec(v);
  if (!hit || !KEY_TABLES[hit[1]]) return v;
  const id = m.soft(KEY_TABLES[hit[1]], Number(hit[2]));
  return id === null ? v : `${hit[1]}:${id}${hit[3]}`;
}

const LEDGER_REFS = {
  party: { voucherId: "vouchers", partyId: "parties" },
  money: { voucherId: "vouchers", accountId: "accounts" },
  stock: { voucherId: "vouchers", lineId: "voucher_lines", itemId: "items", locationId: "locations" },
} as const;

const AUDIT_ENTITIES: Record<string, string> = { employee: "employees", voucher: "vouchers", party: "parties", item: "items", account: "accounts", gl_account: "gl_accounts", journal: "journals", fixed_asset: "fixed_assets", firm: "firms" };

/** In insert order: every table comes after the tables it points to. */
const SPECS: Spec[] = [
  { key: "firms", table: s.firms, id: true, where: (ids) => inArray(s.firms.id, ids) },
  { key: "settings", table: s.settings, refs: { firmId: "firms" }, where: byFirm(s.settings.firmId) },
  { key: "firm_images", table: s.firmImages, refs: { firmId: "firms" }, where: byFirm(s.firmImages.firmId) },
  {
    key: "zatca_settings",
    table: s.zatcaSettings,
    refs: { firmId: "firms" },
    // The device key, certificates and API secrets stay on this server; a restored company goes through ZATCA onboarding again.
    omit: ["privateKeyEnc", "csr", "complianceCert", "complianceSecretEnc", "complianceRequestId", "productionCert", "productionSecretEnc"],
    where: byFirm(s.zatcaSettings.firmId),
    fix: (r) => {
      r.status = "not_started";
      r.enabled = false;
    },
  },
  { key: "locations", table: s.locations, id: true, refs: { firmId: "firms" }, where: byFirm(s.locations.firmId) },
  { key: "tax_rates", table: s.taxRates, id: true, refs: { firmId: "firms" }, where: byFirm(s.taxRates.firmId) },
  { key: "units", table: s.units, id: true, refs: { firmId: "firms" }, where: byFirm(s.units.firmId) },
  { key: "item_categories", table: s.itemCategories, id: true, refs: { firmId: "firms" }, where: byFirm(s.itemCategories.firmId) },
  { key: "ledger_categories", table: s.ledgerCategories, id: true, refs: { firmId: "firms" }, where: byFirm(s.ledgerCategories.firmId) },
  { key: "custom_fields", table: s.customFields, id: true, refs: { firmId: "firms" }, where: byFirm(s.customFields.firmId) },
  { key: "price_lists", table: s.priceLists, id: true, refs: { firmId: "firms" }, where: byFirm(s.priceLists.firmId) },
  { key: "party_groups", table: s.partyGroups, id: true, refs: { firmId: "firms" }, where: byFirm(s.partyGroups.firmId) },
  { key: "parties", table: s.parties, id: true, refs: { firmId: "firms", groupId: "party_groups", priceListId: "price_lists" }, where: byFirm(s.parties.firmId) },
  {
    key: "items",
    table: s.items,
    id: true,
    refs: { firmId: "firms", categoryId: "item_categories", unitId: "units", altUnitId: "units", taxRateId: "tax_rates" },
    where: byFirm(s.items.firmId),
    fix: (r, m) => {
      const cv = (r.customValues ?? {}) as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(cv)) {
        const id = m.soft("custom_fields", Number(k));
        if (id !== null) out[String(id)] = v;
      }
      r.customValues = out;
    },
  },
  { key: "item_location_levels", table: s.itemLocationLevels, refs: { itemId: "items", locationId: "locations" }, where: firmItems(s.itemLocationLevels.itemId) },
  { key: "item_openings", table: s.itemOpenings, refs: { itemId: "items", locationId: "locations" }, where: firmItems(s.itemOpenings.itemId) },
  { key: "item_prices", table: s.itemPrices, refs: { priceListId: "price_lists", itemId: "items" }, where: firmItems(s.itemPrices.itemId) },
  { key: "party_rates", table: s.partyRates, refs: { partyId: "parties", itemId: "items" }, where: firmParties(s.partyRates.partyId) },
  { key: "employees", table: s.employees, id: true, refs: { firmId: "firms", locationId: "locations" }, where: byFirm(s.employees.firmId) },
  { key: "salary_adjustments", table: s.salaryAdjustments, refs: { employeeId: "employees" }, where: (ids) => sql`${s.salaryAdjustments.employeeId} in (select id from employees where firm_id in (${list(ids)}))` },
  { key: "accounts", table: s.accounts, id: true, refs: { firmId: "firms" }, where: byFirm(s.accounts.firmId) },
  { key: "gl_accounts", table: s.glAccounts, id: true, refs: { firmId: "firms" }, where: byFirm(s.glAccounts.firmId), fix: (r, m) => void (r.key = fixKey(r.key, m)) },
  { key: "journals", table: s.journals, id: true, refs: { firmId: "firms" }, users: ["createdBy"], where: byFirm(s.journals.firmId) },
  { key: "fixed_assets", table: s.fixedAssets, id: true, refs: { firmId: "firms", paidFromAccountId: "accounts" }, where: byFirm(s.fixedAssets.firmId) },
  {
    key: "vouchers",
    table: s.vouchers,
    id: true,
    refs: { firmId: "firms", locationId: "locations", toLocationId: "locations", partyId: "parties", accountId: "accounts", toAccountId: "accounts", categoryId: "ledger_categories", employeeId: "employees" },
    users: ["receivedBy", "createdBy", "updatedBy", "deletedBy"],
    where: byFirm(s.vouchers.firmId),
    fix: (r, m) => {
      r.sourceVoucherId = m.soft("vouchers", r.sourceVoucherId);
      // A deleted bill keeps its ledger rows here so it can be brought back; those rows point at other rows too.
      const snap = r.deletedSnapshot as { party?: Row[]; money?: Row[]; stock?: Row[]; allocations?: Row[] } | null;
      if (!snap) return;
      for (const kind of ["party", "money", "stock"] as const) {
        for (const row of snap[kind] ?? []) for (const [col, table] of Object.entries(LEDGER_REFS[kind])) row[col] = m.soft(table, row[col]);
      }
      for (const a of snap.allocations ?? []) {
        a.fromVoucherId = m.soft("vouchers", a.fromVoucherId);
        a.toVoucherId = m.soft("vouchers", a.toVoucherId);
      }
    },
  },
  { key: "voucher_lines", table: s.voucherLines, id: true, refs: { voucherId: "vouchers", itemId: "items", taxRateId: "tax_rates" }, where: firmVouchers(s.voucherLines.voucherId) },
  { key: "allocations", table: s.allocations, id: true, refs: { fromVoucherId: "vouchers", toVoucherId: "vouchers" }, where: firmVouchers(s.allocations.fromVoucherId) },
  { key: "voucher_sources", table: s.voucherSources, refs: { voucherId: "vouchers", sourceId: "vouchers" }, where: firmVouchers(s.voucherSources.voucherId) },
  { key: "party_ledger", table: s.partyLedger, id: true, refs: LEDGER_REFS.party, where: firmParties(s.partyLedger.partyId) },
  { key: "money_ledger", table: s.moneyLedger, id: true, refs: LEDGER_REFS.money, where: firmAccounts(s.moneyLedger.accountId) },
  { key: "stock_ledger", table: s.stockLedger, id: true, refs: LEDGER_REFS.stock, where: firmItems(s.stockLedger.itemId) },
  {
    key: "gl_entries",
    table: s.glEntries,
    id: true,
    refs: { firmId: "firms", accountId: "gl_accounts", voucherId: "vouchers", journalId: "journals" },
    where: byFirm(s.glEntries.firmId),
    fix: (r, m) => void (r.refKey = fixKey(r.refKey, m)),
  },
  { key: "service_reminders", table: s.serviceReminders, id: true, refs: { firmId: "firms", voucherId: "vouchers", partyId: "parties", itemId: "items" }, where: byFirm(s.serviceReminders.firmId) },
  {
    key: "notifications",
    table: s.notifications,
    id: true,
    refs: { firmId: "firms" },
    where: byFirm(s.notifications.firmId),
    fix: (r, m) => {
      r.partyId = m.soft("parties", r.partyId);
      r.refId = r.refType === "voucher" ? m.soft("vouchers", r.refId) : r.refType === "party" ? m.soft("parties", r.refId) : null;
    },
  },
  { key: "zatca_invoices", table: s.zatcaInvoices, id: true, refs: { firmId: "firms", voucherId: "vouchers" }, where: byFirm(s.zatcaInvoices.firmId) },
  {
    key: "audit_log",
    table: s.auditLog,
    id: true,
    refs: { firmId: "firms" },
    users: ["userId"],
    where: byFirm(s.auditLog.firmId),
    fix: (r, m) => {
      const t = AUDIT_ENTITIES[String(r.entity)];
      r.entityId = t ? m.soft(t, r.entityId) : null;
    },
  },
];

/** Tables deliberately left out: logins and access (security), links and job records (tied to this server). */
export const EXCLUDED_TABLES = ["roles", "users", "user_firms", "user_locations", "sessions", "login_attempts", "share_links", "backup_runs", "backup_requests"];
export const BACKUP_TABLES = SPECS.map((sp) => sp.key);

// ─── Cell encoding ────────────────────────────────────────────────────────────

interface Col {
  prop: string;
  name: string;
  col: PgColumn;
}

function columnsOf(sp: Spec): Col[] {
  return Object.entries(getTableColumns(sp.table))
    .filter(([prop]) => !sp.omit?.includes(prop))
    .map(([prop, col]) => ({ prop, name: col.name, col: col as PgColumn }));
}

const isBytes = (c: PgColumn) => c.columnType === "PgCustomColumn";

function encode(v: unknown, c: PgColumn): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (isBytes(c)) return (v as Buffer).toString("base64");
  if (v instanceof Date) return v.toISOString();
  if (c.dataType === "json" || c.dataType === "array") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return String(v);
}

/** Whatever Excel stored in the cell, as a plain value. */
function plain(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return plain(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return v;
}

function decode(raw: unknown, c: Col, where: string): unknown {
  if (raw === null || raw === undefined || raw === "") {
    // A NOT NULL column must never get `null` here, even when the cell is blank because the
    // original value genuinely was "" (e.g. vouchers.prefix) — Excel can't tell "" apart from a
    // truly empty cell, so fall back to that type's empty value rather than violating the constraint.
    if (c.col.notNull) {
      if (c.col.dataType === "string") return "";
      if (c.col.dataType === "number") return 0;
      if (c.col.dataType === "boolean") return false;
    }
    return null;
  }
  const bad = (what: string) => new MasterError(`${where}, column ${c.name}: ${what}.`);
  if (isBytes(c.col)) return Buffer.from(String(raw), "base64");
  switch (c.col.dataType) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isSafeInteger(n)) throw bad(`"${String(raw)}" should be a whole number`);
      return n;
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const t = String(raw).trim().toLowerCase();
      if (["true", "1", "yes"].includes(t)) return true;
      if (["false", "0", "no"].includes(t)) return false;
      throw bad(`"${String(raw)}" should be TRUE or FALSE`);
    }
    case "date": {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw bad(`"${String(raw)}" isn't a date and time`);
      return d;
    }
    case "json":
    case "array":
      try {
        return JSON.parse(String(raw));
      } catch {
        throw bad("the value is damaged");
      }
    default:
      // A date column Excel turned into a real date after someone edited the file.
      if (raw instanceof Date) return raw.toISOString().slice(0, 10);
      return String(raw);
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

/** Every company this person may back up: the owner gets all of them, including hidden ones. */
export async function backupFirmIds(db: DB, user: { isOwner: boolean; firms: { id: number }[] }): Promise<number[]> {
  if (!user.isOwner) return user.firms.map((f) => f.id);
  return (await db.select({ id: s.firms.id }).from(s.firms).orderBy(asc(s.firms.id))).map((f) => f.id);
}

export async function exportAllData(db: DB, firmIds: Ids, by: { id: number; name: string; email: string }): Promise<{ buffer: Buffer; companies: string[]; rows: number }> {
  if (firmIds.length === 0) throw new MasterError("There is no company to back up.");
  const userEmails = new Map((await db.select({ id: s.users.id, email: s.users.email }).from(s.users)).map((u) => [u.id, u.email]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Billing";
  wb.created = new Date();
  const info = wb.addWorksheet(INFO_SHEET);
  const long: (string | number)[][] = [];
  const counts: [string, number][] = [];

  for (const sp of SPECS) {
    const cols = columnsOf(sp);
    const idCol = getTableColumns(sp.table).id as PgColumn | undefined;
    const q = db.select().from(sp.table).where(sp.where(firmIds));
    const rows = (idCol ? await q.orderBy(asc(idCol)) : await q) as Row[];

    const ws = wb.addWorksheet(sp.key);
    const header: string[] = [];
    for (const c of cols) {
      header.push(c.name);
      if (sp.users?.includes(c.prop)) header.push(`${c.name}_email`);
    }
    ws.addRow(header);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    rows.forEach((r, i) => {
      const out: (string | number | boolean | null)[] = [];
      for (const c of cols) {
        let v = encode(r[c.prop], c.col);
        if (typeof v === "string" && v.length > CELL_LIMIT) {
          for (let p = 0; p * CELL_LIMIT < v.length; p++) long.push([sp.key, i + 1, c.name, p, v.slice(p * CELL_LIMIT, (p + 1) * CELL_LIMIT)]);
          v = LONG_MARKER;
        }
        out.push(v);
        if (sp.users?.includes(c.prop)) out.push(r[c.prop] == null ? null : (userEmails.get(r[c.prop] as number) ?? null));
      }
      ws.addRow(out);
    });
    header.forEach((h, i) => (ws.getColumn(i + 1).width = Math.min(40, Math.max(10, h.length + 2))));
    counts.push([sp.key, rows.length]);
  }

  const lw = wb.addWorksheet(LONG_SHEET);
  lw.addRow(["sheet", "row", "column", "part", "text"]);
  for (const l of long) lw.addRow(l);

  const names = (await db.select({ name: s.firms.name }).from(s.firms).where(inArray(s.firms.id, firmIds)).orderBy(asc(s.firms.id))).map((f) => f.name);
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 70;
  info.addRows([
    ["Format", BACKUP_FORMAT],
    ["Format version", BACKUP_VERSION],
    ["Exported at", new Date().toISOString()],
    ["Exported by", `${by.name} <${by.email}>`],
    ["Companies", names.join(", ")],
    ["", ""],
    ["Note", "A full copy of your business data. Keep it safe: it contains every bill, party and price."],
    ["", "To bring it back: Settings → Backups → Restore from Excel. It is added as a new company."],
    ["", "Don't edit, add or remove rows: the restore checks the row counts below and refuses a changed file."],
    ["", ""],
    ["Sheet", "Rows"],
    ...counts,
  ]);
  info.getRow(11).font = { bold: true };
  info.getColumn(1).font = { bold: true };

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), companies: names, rows: counts.reduce((a, [, n]) => a + n, 0) };
}

// ─── Restore ──────────────────────────────────────────────────────────────────

interface Parsed {
  sheet: string;
  rows: { values: Row; emails: Record<string, string | null> }[];
}

async function readBackup(buf: Buffer): Promise<{ parsed: Map<string, Parsed>; companies: string[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new MasterError("This file couldn't be opened as an Excel workbook.");
  }
  const info = wb.getWorksheet(INFO_SHEET);
  if (!info) throw new MasterError(`This isn't a backup made by this app (there is no "${INFO_SHEET}" sheet). Use the file from Settings → Backups → Download all data.`);
  const kv = new Map<string, unknown>();
  const counts = new Map<string, number>();
  let inCounts = false;
  info.eachRow((row) => {
    const k = String(plain(row.getCell(1).value) ?? "").trim();
    const v = plain(row.getCell(2).value);
    if (k === "Sheet") inCounts = true;
    else if (inCounts && k) counts.set(k, Number(v));
    else if (k) kv.set(k, v);
  });
  if (kv.get("Format") !== BACKUP_FORMAT) throw new MasterError("This isn't a backup made by this app.");
  const version = Number(kv.get("Format version"));
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_VERSION) throw new MasterError("This backup was made by a newer version of the app. Update the app first, then restore it.");

  const long = new Map<string, string[]>();
  wb.getWorksheet(LONG_SHEET)?.eachRow((row, n) => {
    if (n === 1) return;
    const [sheet, r, col, part, text] = [1, 2, 3, 4, 5].map((i) => plain(row.getCell(i).value));
    const key = `${String(sheet)}|${Number(r)}|${String(col)}`;
    const parts = long.get(key) ?? [];
    parts[Number(part)] = String(text ?? "");
    long.set(key, parts);
  });

  const parsed = new Map<string, Parsed>();
  for (const sp of SPECS) {
    const ws = wb.getWorksheet(sp.key);
    const expected = counts.get(sp.key);
    if (!ws) {
      // A table added to the app after this backup was made: nothing to restore for it.
      if (expected) throw new MasterError(`The "${sp.key}" sheet is missing from the file.`);
      parsed.set(sp.key, { sheet: sp.key, rows: [] });
      continue;
    }
    const cols = columnsOf(sp);
    const byName = new Map(cols.map((c) => [c.name, c]));
    const header: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, i) => (header[i] = String(plain(cell.value) ?? "").trim()));
    const out: Parsed = { sheet: sp.key, rows: [] };
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const values: Row = {};
      const emails: Record<string, string | null> = {};
      header.forEach((h, i) => {
        if (!h) return;
        let raw = plain(row.getCell(i).value);
        if (h.endsWith("_email") && !byName.has(h)) {
          emails[h.slice(0, -"_email".length)] = raw == null || raw === "" ? null : String(raw).trim().toLowerCase();
          return;
        }
        const c = byName.get(h);
        if (!c) return; // a column this version of the app no longer has
        if (raw === LONG_MARKER) raw = (long.get(`${sp.key}|${n - 1}|${h}`) ?? []).join("");
        values[c.prop] = decode(raw, c, `Sheet "${sp.key}", row ${n}`);
      });
      out.rows.push({ values, emails });
    });
    if (expected !== undefined && expected !== out.rows.length) {
      throw new MasterError(`The "${sp.key}" sheet has ${out.rows.length} rows but the backup recorded ${expected}. The file was changed after it was downloaded, so it can't be restored safely.`);
    }
    if (out.rows.length > 0) {
      const present = new Set(header.filter(Boolean));
      for (const c of cols) {
        if (c.prop === "id" && sp.id) {
          if (!present.has("id")) throw new MasterError(`The "${sp.key}" sheet has no id column.`);
          continue;
        }
        if (c.col.notNull && !c.col.hasDefault && !present.has(c.name)) throw new MasterError(`The "${sp.key}" sheet is missing the "${c.name}" column.`);
      }
    }
    parsed.set(sp.key, out);
  }
  if (!parsed.get("firms")?.rows.length) throw new MasterError("The backup has no company in it.");
  const companies = parsed.get("firms")!.rows.map((r) => String(r.values.name));
  return { parsed, companies };
}

/** Checks a backup file without writing anything: which companies it holds and how many rows. */
export async function inspectBackup(buf: Buffer) {
  const { parsed, companies } = await readBackup(buf);
  return { companies, rows: [...parsed.values()].reduce((a, p) => a + p.rows.length, 0) };
}

const restoredName = (name: string, when: Date) => {
  const tag = ` (restored ${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })})`;
  return name.slice(0, 200 - tag.length) + tag;
};

/**
 * Adds every company in the file as a new company. One transaction: if anything is wrong, nothing is
 * written. Existing companies are never touched.
 */
export async function restoreAllData(db: DB, buf: Buffer, by: { id: number; isOwner: boolean }, ip?: string | null) {
  const { parsed } = await readBackup(buf);
  const when = new Date();

  return db.transaction(async (tx) => {
    const m = new Remap();
    const userByEmail = new Map((await tx.select({ id: s.users.id, email: s.users.email }).from(s.users)).map((u) => [u.email.toLowerCase(), u.id]));

    // Hand out every new ID up front, so rows pointing forwards (a bill made from an order, a deleted bill's snapshot) can be rewritten in one pass.
    for (const sp of SPECS) {
      if (!sp.id) continue;
      const old = parsed.get(sp.key)!.rows.map((r) => r.values.id as number).sort((a, b) => a - b);
      if (new Set(old).size !== old.length) throw new MasterError(`The "${sp.key}" sheet lists the same id twice.`);
      const fresh = old.length ? await allocateIds(tx, sp.key, old.length) : [];
      m.set(sp.key, new Map(old.map((o, i) => [o, fresh[i]])));
    }

    const created: { id: number; name: string }[] = [];
    const rowCounts: Record<string, number> = {};
    for (const sp of SPECS) {
      const rows = parsed.get(sp.key)!.rows.map(({ values, emails }, i) => {
        const r: Row = { ...values };
        const where = `Sheet "${sp.key}", row ${i + 2}`;
        if (sp.id) r.id = m.get(sp.key, values.id as number, where);
        for (const [col, table] of Object.entries(sp.refs ?? {})) if (r[col] !== null && r[col] !== undefined) r[col] = m.get(table, r[col] as number, `${where}, ${col}`);
        for (const col of sp.users ?? []) {
          const name = getTableColumns(sp.table)[col].name;
          const email = emails[name];
          r[col] = email ? (userByEmail.get(email) ?? null) : null;
        }
        sp.fix?.(r, m);
        for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
        return r;
      });
      if (sp.key === "firms") {
        for (const r of rows) {
          r.name = restoredName(String(r.name), when);
          created.push({ id: r.id as number, name: r.name as string });
        }
      }
      if (sp.key === "items") ensureProductIds(rows);
      await insertChunked(tx, sp.table, rows);
      rowCounts[sp.key] = rows.length;
    }

    for (const f of created) {
      // Owners open every company already; anyone else needs access to the companies they restored.
      if (!by.isOwner) await tx.insert(s.userFirms).values({ userId: by.id, firmId: f.id }).onConflictDoNothing();
      await audit(tx, { firmId: f.id, userId: by.id, action: "restore", entity: "firm", entityId: f.id, summary: `Restored company "${f.name}" from an Excel backup`, ip });
    }
    return { companies: created, rows: rowCounts };
  });
}

/**
 * Every product needs a Product ID, unique in its company ignoring case. A backup made before that
 * rule may hold products with none: they get the next numbers after the company's highest. Two
 * products sharing an ID can't be guessed at, so that stops the restore with the names to fix.
 */
function ensureProductIds(rows: Row[]) {
  const byFirm = new Map<number, Row[]>();
  for (const r of rows) byFirm.set(r.firmId as number, [...(byFirm.get(r.firmId as number) ?? []), r]);
  for (const list of byFirm.values()) {
    const seen = new Map<string, Row>();
    for (const r of list) {
      const code = String(r.code ?? "").trim();
      r.code = code;
      if (!code) continue;
      const other = seen.get(code.toLowerCase());
      if (other) throw new MasterError(`Sheet "items": the Product ID "${code}" is on two products of the same company ("${String(other.name)}" and "${String(r.name)}"). Change one of them in the file, then restore again.`);
      seen.set(code.toLowerCase(), r);
    }
    const codes = [...seen.values()].map((r) => r.code as string);
    for (const r of list) {
      if (r.code) continue;
      r.code = nextProductId(codes, { prefix: "", digits: 0 });
      codes.push(r.code as string);
    }
  }
}

async function allocateIds(tx: Tx, table: string, n: number): Promise<number[]> {
  const rows = await tx
    .select({ id: sql<number>`nextval(pg_get_serial_sequence(${table}, 'id'))::int` })
    .from(sql`generate_series(1, ${n}::int)`);
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

async function insertChunked(tx: Tx, table: PgTable, rows: Row[]) {
  if (rows.length === 0) return;
  const width = Object.keys(getTableColumns(table)).length;
  const size = Math.max(1, Math.floor(30_000 / width));
  for (let i = 0; i < rows.length; i += size) await tx.insert(table).values(rows.slice(i, i + size) as never);
}

/** Row count per backed-up table for the given companies (used by tests and the result screen). */
export async function countRows(db: DB | Tx, firmIds: Ids): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const sp of SPECS) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(sp.table).where(sp.where(firmIds));
    out[sp.key] = r.n;
  }
  return out;
}

export async function firmName(db: DB, id: number) {
  const [f] = await db.select({ name: s.firms.name }).from(s.firms).where(eq(s.firms.id, id));
  return f?.name ?? null;
}
