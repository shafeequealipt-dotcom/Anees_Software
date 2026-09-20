import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { itemCategories, items, parties, partyGroups, taxRates, units } from "@/db/schema";
import { GST_STATES } from "@/lib/gst/states";
import { toMilli, toPaise, formatPercent } from "@/lib/money";
import { region } from "@/lib/region";
import { type Column, pick, type Table, yes } from "./excel";
import { listCustomFields } from "./custom-fields";
import { MasterError, saveCategory, saveItem, saveParty, savePartyGroup, saveUnit } from "./masters";

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
  dryRun: boolean;
}

class Rollback extends Error {}

/** Runs the work; when `dryRun`, everything is rolled back at the end so nothing is saved. */
async function maybeDry(db: DB, dryRun: boolean, work: (db: DB) => Promise<ImportResult>): Promise<ImportResult> {
  if (!dryRun) return work(db);
  let out!: ImportResult;
  try {
    await db.transaction(async (tx) => {
      out = await work(tx as unknown as DB);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out;
}

const num = (v: string, label: string, scale: (s: string) => number) => {
  const n = scale(v);
  if (Number.isNaN(n)) throw new MasterError(`${label}: "${v}" is not a number.`);
  return n;
};

// ─── Parties ─────────────────────────────────────────────────────────────────

export function partyColumns(opts: { contact: boolean; balance: boolean }): Column[] {
  const r = region();
  return [
    { header: "Name", key: "name", width: 30 },
    { header: "Type", key: "type", width: 12 },
    ...(opts.contact
      ? ([
          { header: "Phone", key: "phone" },
          { header: "Email", key: "email", width: 26 },
          { header: r.taxIdLabel, key: "taxId", width: 18 },
          ...(r.usesStates ? [{ header: "State", key: "state", width: 18 }] : []),
          { header: "Billing address", key: "address", width: 34 },
          { header: "Shipping address", key: "shipping", width: 34 },
        ] as Column[])
      : []),
    { header: "Group", key: "group" },
    ...(opts.balance
      ? ([
          { header: "Opening balance", key: "opening", kind: "money" },
          { header: "Balance type", key: "side" },
          { header: "Credit days", key: "creditDays", kind: "number" },
          { header: "Credit limit", key: "creditLimit", kind: "money" },
        ] as Column[])
      : []),
  ];
}

export async function exportParties(db: DB, firmId: number, opts: { contact: boolean; balance: boolean }) {
  const list = await db.select().from(parties).where(eq(parties.firmId, firmId)).orderBy(asc(parties.name));
  const groups = new Map((await db.select().from(partyGroups).where(eq(partyGroups.firmId, firmId))).map((g) => [g.id, g.name]));
  return list.map((p) => ({
    name: p.name,
    type: p.kind === "both" ? "Customer & supplier" : p.kind === "customer" ? "Customer" : "Supplier",
    phone: p.phone,
    email: p.email,
    taxId: p.gstin,
    state: p.stateCode ? (GST_STATES.find((s) => s.code === p.stateCode)?.name ?? p.stateCode) : "",
    address: p.billingAddress,
    shipping: p.shippingAddress,
    group: p.groupId ? groups.get(p.groupId) : "",
    opening: Math.abs(p.openingBalancePaise) / 100,
    side: p.openingBalancePaise < 0 ? "To pay" : "To receive",
    creditDays: p.creditDays,
    creditLimit: p.creditLimitPaise == null ? null : p.creditLimitPaise / 100,
  }));
}

export const partyTemplateRow = () => ({ name: "Example Traders", type: "Customer", phone: "9876543210", email: "accounts@example.com", taxId: "", state: region().usesStates ? "Maharashtra" : undefined, address: "12 Main Road", group: "Retailers", opening: 0, side: "To receive", creditDays: 15 });

export async function importParties(db: DB, firmId: number, table: Table, userId: number, dryRun: boolean): Promise<ImportResult> {
  return maybeDry(db, dryRun, async (d) => {
    const res: ImportResult = { total: table.rows.length, created: 0, updated: 0, skipped: 0, errors: [], dryRun };
    const existing = new Set((await d.select({ n: parties.name }).from(parties).where(eq(parties.firmId, firmId))).map((p) => p.n.toLowerCase()));
    const seen = new Set<string>();
    const R = region();
    for (const { line, cells } of table.rows) {
      try {
        const name = pick(cells, "Name", "Party name");
        if (!name) throw new MasterError("Name is missing.");
        if (existing.has(name.toLowerCase()) || seen.has(name.toLowerCase())) {
          res.skipped++;
          res.errors.push({ line, message: `"${name}" already exists, so it was left as it is.` });
          continue;
        }
        const type = pick(cells, "Type").toLowerCase();
        const kind = /both|&/.test(type) ? "both" : /supplier|vendor/.test(type) ? "supplier" : "customer";
        let stateCode: string | undefined;
        const st = pick(cells, "State", "State code");
        if (R.usesStates && st) {
          const hit = GST_STATES.find((s) => s.code === st.padStart(2, "0") || s.name.toLowerCase() === st.toLowerCase());
          if (!hit) throw new MasterError(`State "${st}" isn't recognised. Use the state's name or its two-digit code.`);
          stateCode = hit.code;
        }
        const opening = pick(cells, "Opening balance", "Balance");
        let openingPaise = opening ? num(opening, "Opening balance", toPaise) : 0;
        if (/pay/i.test(pick(cells, "Balance type", "Balance side"))) openingPaise = -Math.abs(openingPaise);
        const group = pick(cells, "Group");
        const days = pick(cells, "Credit days");
        const limit = pick(cells, "Credit limit");
        await saveParty(
          d,
          firmId,
          {
            kind,
            name,
            phone: pick(cells, "Phone", "Mobile") || null,
            email: pick(cells, "Email") || null,
            gstin: pick(cells, R.taxIdLabel, "GSTIN", "VAT number", "TRN", "Tax number") || null,
            stateCode: stateCode ?? null,
            billingAddress: pick(cells, "Billing address", "Address") || null,
            shippingAddress: pick(cells, "Shipping address") || null,
            groupId: group ? await savePartyGroup(d, firmId, group) : null,
            openingBalancePaise: openingPaise,
            creditDays: days ? Math.round(num(days, "Credit days", Number)) : null,
            creditLimitPaise: limit ? num(limit, "Credit limit", toPaise) : null,
          },
          userId,
        );
        seen.add(name.toLowerCase());
        res.created++;
      } catch (e) {
        if (!(e instanceof MasterError)) throw e;
        res.errors.push({ line, message: e.message });
      }
    }
    return res;
  });
}

// ─── Items (also used for bulk updates: export, edit in Excel, import again) ──

export function itemColumns(opts: { purchase: boolean; custom?: { id: number; name: string }[] }): Column[] {
  const r = region();
  return [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 32 },
    { header: "Item code", key: "code" },
    { header: "Type", key: "type", width: 10 },
    ...(r.usesHsn ? [{ header: "HSN/SAC", key: "hsn" }] : []),
    { header: "Category", key: "category", width: 18 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Sale price", key: "sale", kind: "money" },
    { header: "Sale price includes tax", key: "saleIncl", width: 14 },
    ...(opts.purchase
      ? ([
          { header: "Purchase price", key: "purchase", kind: "money" },
          { header: "Purchase price includes tax", key: "purchaseIncl", width: 14 },
        ] as Column[])
      : []),
    { header: "MRP", key: "mrp", kind: "money" },
    { header: `${r.taxName} rate %`, key: "tax", kind: "number" },
    { header: "Opening stock", key: "openingQty", kind: "number" },
    ...(opts.purchase ? ([{ header: "Opening stock cost per unit", key: "openingRate", kind: "money" }] as Column[]) : []),
    { header: "Low-stock alert", key: "minStock", kind: "number" },
    { header: "Location", key: "location" },
    { header: "Description", key: "description", width: 30 },
    ...(opts.custom ?? []).map((f) => ({ header: f.name, key: `cf:${f.id}`, width: 18 })),
    { header: "Active", key: "active", width: 8 },
  ];
}

export async function exportItems(db: DB, firmId: number, custom: { id: number }[] = []) {
  const list = await db.select().from(items).where(eq(items.firmId, firmId)).orderBy(asc(items.name));
  const cats = new Map((await db.select().from(itemCategories).where(eq(itemCategories.firmId, firmId))).map((c) => [c.id, c.name]));
  const us = new Map((await db.select().from(units).where(eq(units.firmId, firmId))).map((u) => [u.id, u.code]));
  const tx = new Map((await db.select().from(taxRates).where(eq(taxRates.firmId, firmId))).map((t) => [t.id, t]));
  return list.map((i) => ({
    id: i.id,
    name: i.name,
    code: i.code,
    type: i.kind === "service" ? "Service" : "Goods",
    hsn: i.hsn,
    category: i.categoryId ? cats.get(i.categoryId) : "",
    unit: i.unitId ? us.get(i.unitId) : "",
    sale: i.salePricePaise / 100,
    saleIncl: i.salePriceIncludesTax ? "Yes" : "No",
    purchase: i.purchasePricePaise / 100,
    purchaseIncl: i.purchasePriceIncludesTax ? "Yes" : "No",
    mrp: i.mrpPaise == null ? null : i.mrpPaise / 100,
    tax: i.taxRateId ? (tx.get(i.taxRateId)?.gstBp ?? 0) / 100 : null,
    openingQty: i.openingQtyMilli / 1000,
    openingRate: i.openingRatePaise / 100,
    minStock: i.minStockMilli / 1000,
    location: i.location,
    description: i.description,
    ...Object.fromEntries(custom.map((f) => [`cf:${f.id}`, i.customValues?.[String(f.id)] ?? ""])),
    active: i.active ? "Yes" : "No",
  }));
}

export const itemTemplateRow = () => ({ name: "Example item", code: "EX-01", type: "Goods", hsn: region().usesHsn ? "9608" : undefined, category: "Stationery", unit: "PCS", sale: 100, saleIncl: "No", purchase: 70, purchaseIncl: "No", tax: region().usesStates ? 18 : 15, openingQty: 50, openingRate: 70, minStock: 10, active: "Yes" });

export async function importItems(db: DB, firmId: number, table: Table, userId: number, opts: { dryRun: boolean; purchase: boolean }): Promise<ImportResult> {
  return maybeDry(db, opts.dryRun, async (d) => {
    const res: ImportResult = { total: table.rows.length, created: 0, updated: 0, skipped: 0, errors: [], dryRun: opts.dryRun };
    const all = await d.select().from(items).where(eq(items.firmId, firmId));
    const byId = new Map(all.map((i) => [i.id, i]));
    const byCode = new Map(all.filter((i) => i.code).map((i) => [i.code!.toLowerCase(), i]));
    const byName = new Map(all.map((i) => [i.name.toLowerCase(), i]));
    const unitList = await d.select().from(units).where(eq(units.firmId, firmId));
    const rates = await d.select().from(taxRates).where(and(eq(taxRates.firmId, firmId), eq(taxRates.active, true)));
    const fields = await listCustomFields(d, firmId, { activeOnly: true });

    for (const { line, cells } of table.rows) {
      try {
        const idText = pick(cells, "ID");
        const code = pick(cells, "Item code", "Code");
        const name = pick(cells, "Name", "Item name");
        let cur = idText ? byId.get(Number(idText)) : undefined;
        if (idText && !cur) throw new MasterError(`ID ${idText} doesn't belong to an item in this company.`);
        cur ??= (code && byCode.get(code.toLowerCase())) || (name ? byName.get(name.toLowerCase()) : undefined);
        if (!cur && !name) throw new MasterError("Name is missing.");

        const input: Record<string, unknown> = cur ? { ...cur } : { kind: "goods" };
        delete input.createdAt;
        delete input.updatedAt;
        delete input.firmId;
        const set = (k: string, v: unknown) => {
          input[k] = v;
        };
        if (name) set("name", name);
        if (code) set("code", code);
        const type = pick(cells, "Type").toLowerCase();
        if (type) set("kind", /serv/.test(type) ? "service" : "goods");
        const hsn = pick(cells, "HSN/SAC", "HSN", "SAC");
        if (hsn) set("hsn", hsn);
        const desc = pick(cells, "Description");
        if (desc) set("description", desc);
        const loc = pick(cells, "Location");
        if (loc) set("location", loc);
        const cat = pick(cells, "Category");
        if (cat) set("categoryId", await saveCategory(d, firmId, cat));
        const unit = pick(cells, "Unit");
        if (unit) {
          const hit = unitList.find((u) => u.code.toLowerCase() === unit.toLowerCase() || u.name.toLowerCase() === unit.toLowerCase());
          if (hit) set("unitId", hit.id);
          else {
            const id = await saveUnit(d, firmId, { name: unit, code: unit.slice(0, 10), active: true });
            unitList.push({ id, firmId, name: unit, code: unit.slice(0, 10).toUpperCase(), active: true });
            set("unitId", id);
          }
        }
        const sale = pick(cells, "Sale price");
        if (sale) set("salePricePaise", num(sale, "Sale price", toPaise));
        const saleIncl = pick(cells, "Sale price includes tax");
        if (saleIncl) set("salePriceIncludesTax", yes(saleIncl));
        const mrp = pick(cells, "MRP");
        if (mrp) set("mrpPaise", num(mrp, "MRP", toPaise));
        const tax = pick(cells, `${region().taxName} rate %`, "Tax rate %", "Tax rate", "GST rate %", "VAT rate %", "GST", "VAT");
        if (tax) {
          const pct = Number(tax.replace(/[%\s]/g, ""));
          const hit = rates.find((r) => r.name.toLowerCase() === tax.toLowerCase()) ?? (Number.isFinite(pct) ? rates.filter((r) => r.gstBp === Math.round(pct * 100)).sort((a, b) => (a.nature === "taxable" ? -1 : 1) - (b.nature === "taxable" ? -1 : 1))[0] : undefined);
          if (!hit) throw new MasterError(`Tax rate "${tax}" isn't set up. Add it under Settings → Tax rates first (existing: ${rates.map((r) => formatPercent(r.gstBp)).join(", ")}).`);
          set("taxRateId", hit.id);
        }
        const oq = pick(cells, "Opening stock");
        if (oq) set("openingQtyMilli", num(oq, "Opening stock", toMilli));
        const ms = pick(cells, "Low-stock alert", "Minimum stock");
        if (ms) set("minStockMilli", num(ms, "Low-stock alert", toMilli));
        const cvals: Record<string, string> = { ...((input.customValues as Record<string, string> | undefined) ?? {}) };
        for (const f of fields) {
          const t = pick(cells, f.name);
          if (t) cvals[String(f.id)] = t;
        }
        if (fields.length) set("customValues", cvals);
        const active = pick(cells, "Active");
        if (active) set("active", yes(active));
        if (opts.purchase) {
          const pp = pick(cells, "Purchase price");
          if (pp) set("purchasePricePaise", num(pp, "Purchase price", toPaise));
          const pi = pick(cells, "Purchase price includes tax");
          if (pi) set("purchasePriceIncludesTax", yes(pi));
          const or = pick(cells, "Opening stock cost per unit", "Opening stock rate");
          if (or) set("openingRatePaise", num(or, "Opening stock cost per unit", toPaise));
        }
        await saveItem(d, firmId, input as never, userId);
        if (cur) res.updated++;
        else res.created++;
      } catch (e) {
        if (!(e instanceof MasterError)) throw e;
        res.errors.push({ line, message: e.message });
      }
    }
    return res;
  });
}

