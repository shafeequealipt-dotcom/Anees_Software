import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { accounts, firms, fixedAssets, glAccounts, glEntries, items, journals, ledgerCategories, moneyLedger, parties, partyLedger, vouchers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { addDays, financialYear, todayIST } from "@/lib/dates";
import { depreciationForYear, GL_TYPES, isBalanced, journalForVoucher, openingJournal, type GlLine } from "@/lib/gl";
import { getSettings, saveSettings } from "@/lib/settings";
import { MasterError } from "./masters";

type D = DB | Tx;

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
const BASE: Record<AccountType, number> = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 5000 };

const SYSTEM: Record<string, { name: string; type: AccountType; grp: string }> = {
  receivable: { name: "Sundry debtors (customers)", type: "asset", grp: "Current assets" },
  payable: { name: "Sundry creditors (suppliers)", type: "liability", grp: "Current liabilities" },
  sales: { name: "Sales", type: "income", grp: "Sales" },
  purchases: { name: "Purchases", type: "expense", grp: "Cost of goods" },
  input_tax: { name: "Input tax (paid on purchases and expenses)", type: "asset", grp: "Current assets" },
  output_tax: { name: "Output tax (collected on sales)", type: "liability", grp: "Current liabilities" },
  round_off: { name: "Round off", type: "income", grp: "Other income" },
  other_income: { name: "Other income", type: "income", grp: "Other income" },
  expense_default: { name: "Other expenses", type: "expense", grp: "Expenses" },
  capital: { name: "Owner's capital and adjustments", type: "equity", grp: "Equity" },
  obe: { name: "Opening balance equity", type: "equity", grp: "Equity" },
  opening_stock: { name: "Opening stock", type: "expense", grp: "Cost of goods" },
  depreciation: { name: "Depreciation", type: "expense", grp: "Expenses" },
  accum_dep: { name: "Accumulated depreciation", type: "asset", grp: "Fixed assets" },
  asset_disposal: { name: "Gain or loss on sale of assets", type: "income", grp: "Other income" },
};

async function nextCode(db: D, firmId: number, type: AccountType) {
  const rows = await db.select({ code: glAccounts.code }).from(glAccounts).where(and(eq(glAccounts.firmId, firmId), eq(glAccounts.type, type)));
  const used = new Set(rows.map((r) => r.code));
  let n = BASE[type] + 10 + rows.length * 10;
  while (used.has(String(n))) n += 10;
  return String(n);
}

/** The id of the account behind a key, creating it (and keeping its name in step with cash/bank accounts and categories) as needed. */
export async function ensureAccount(db: D, firmId: number, key: string): Promise<number> {
  let name: string;
  let type: AccountType;
  let grp: string;
  if (key.startsWith("money:")) {
    const [a] = await db.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, Number(key.slice(6))), eq(accounts.firmId, firmId)));
    if (!a) throw new MasterError("A cash or bank account on this entry no longer exists.");
    name = a.name;
    type = "asset";
    grp = "Cash and bank";
  } else if (key.startsWith("cat:")) {
    const [c] = await db.select().from(ledgerCategories).where(and(eq(ledgerCategories.id, Number(key.slice(4))), eq(ledgerCategories.firmId, firmId)));
    if (!c) throw new MasterError("A category on this entry no longer exists.");
    name = c.name;
    type = c.kind === "income" ? "income" : "expense";
    grp = c.kind === "income" ? "Other income" : "Expenses";
  } else if (key.startsWith("fa:")) {
    name = key.slice(3);
    type = "asset";
    grp = "Fixed assets";
  } else {
    const s = SYSTEM[key];
    if (!s) throw new Error(`Unknown account key ${key}`);
    ({ name, type, grp } = s);
  }
  const [found] = await db.select().from(glAccounts).where(and(eq(glAccounts.firmId, firmId), eq(glAccounts.key, key)));
  if (found) {
    if ((key.startsWith("money:") || key.startsWith("cat:")) && found.name !== name) await db.update(glAccounts).set({ name }).where(eq(glAccounts.id, found.id));
    return found.id;
  }
  const [row] = await db.insert(glAccounts).values({ firmId, code: await nextCode(db, firmId, type), name, type, grp, key }).returning({ id: glAccounts.id });
  return row.id;
}

async function insertLines(db: D, firmId: number, date: string, lines: GlLine[], base: { source: "voucher" | "opening" | "journal" | "asset"; voucherId?: number; journalId?: number; refKey?: string }) {
  if (lines.length === 0) return;
  if (!isBalanced(lines)) throw new Error("Journal entry does not balance");
  const cache = new Map<string, number>();
  const rows = [];
  for (const l of lines) {
    let id = cache.get(l.key);
    if (!id) {
      id = await ensureAccount(db, firmId, l.key);
      cache.set(l.key, id);
    }
    rows.push({ firmId, date, accountId: id, debitPaise: l.debit, creditPaise: l.credit, source: base.source, voucherId: base.voucherId ?? null, journalId: base.journalId ?? null, refKey: base.refKey ?? null, memo: l.memo ?? null });
  }
  await db.insert(glEntries).values(rows);
}

// ─── Keeping the books in step with bills and masters ────────────────────────

/** Rewrites the accounting entries of one bill from its current state. Cancelled and deleted bills have none. */
export async function syncVoucherGl(db: D, firmId: number, voucherId: number) {
  await db.delete(glEntries).where(and(eq(glEntries.voucherId, voucherId), eq(glEntries.source, "voucher")));
  const [v] = await db.select().from(vouchers).where(and(eq(vouchers.id, voucherId), eq(vouchers.firmId, firmId)));
  if (!v || v.status !== "active" || !GL_TYPES.includes(v.type)) return;
  const [p] = await db.select({ n: sql<number>`coalesce(sum(${partyLedger.amountPaise}), 0)::bigint` }).from(partyLedger).where(eq(partyLedger.voucherId, voucherId));
  const money = await db
    .select({ accountId: moneyLedger.accountId, amountPaise: sql<number>`sum(${moneyLedger.amountPaise})::bigint` })
    .from(moneyLedger)
    .where(eq(moneyLedger.voucherId, voucherId))
    .groupBy(moneyLedger.accountId);
  const lines = journalForVoucher(v, Number(p.n), money.map((m) => ({ accountId: m.accountId, amountPaise: Number(m.amountPaise) })));
  await insertLines(db, firmId, v.date, lines, { source: "voucher", voucherId });
}

async function replaceOpening(db: D, firmId: number, refKey: string, date: string, lines: GlLine[]) {
  await db.delete(glEntries).where(and(eq(glEntries.firmId, firmId), eq(glEntries.refKey, refKey), eq(glEntries.source, "opening")));
  await insertLines(db, firmId, date, lines, { source: "opening", refKey });
}

export async function syncPartyOpening(db: D, firmId: number, partyId: number) {
  const [p] = await db.select().from(parties).where(and(eq(parties.id, partyId), eq(parties.firmId, firmId)));
  await replaceOpening(db, firmId, `party:${partyId}`, p?.openingDate ?? todayIST(), p ? openingJournal("party", p.openingBalancePaise) : []);
}

export async function syncAccountOpening(db: D, firmId: number, accountId: number) {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.firmId, firmId)));
  await replaceOpening(db, firmId, `account:${accountId}`, a?.openingDate ?? todayIST(), a ? openingJournal("money", a.openingBalancePaise, `money:${accountId}`) : []);
}

export async function syncItemOpening(db: D, firmId: number, itemId: number) {
  const [i] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.firmId, firmId)));
  const value = i && i.kind === "goods" ? Math.round((i.openingQtyMilli * i.openingRatePaise) / 1000) : 0;
  await replaceOpening(db, firmId, `item:${itemId}`, i?.openingDate ?? todayIST(), i ? openingJournal("stock", value) : []);
}

export async function removeOpening(db: D, firmId: number, refKey: string) {
  await db.delete(glEntries).where(and(eq(glEntries.firmId, firmId), eq(glEntries.refKey, refKey), eq(glEntries.source, "opening")));
}

/** Recomputes every bill and opening entry from scratch. Manual journals and fixed-asset entries are left alone. */
export async function rebuildGl(db: DB, firmId: number) {
  await db.transaction(async (tx) => {
    await tx.delete(glEntries).where(and(eq(glEntries.firmId, firmId), inArray(glEntries.source, ["voucher", "opening"])));
    const vs = await tx.select({ id: vouchers.id }).from(vouchers).where(and(eq(vouchers.firmId, firmId), eq(vouchers.status, "active"), inArray(vouchers.type, GL_TYPES)));
    for (const v of vs) await syncVoucherGl(tx, firmId, v.id);
    for (const p of await tx.select({ id: parties.id }).from(parties).where(eq(parties.firmId, firmId))) await syncPartyOpening(tx, firmId, p.id);
    for (const a of await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.firmId, firmId))) await syncAccountOpening(tx, firmId, a.id);
    for (const i of await tx.select({ id: items.id }).from(items).where(eq(items.firmId, firmId))) await syncItemOpening(tx, firmId, i.id);
    await saveSettings(tx, firmId, { glBuiltAt: new Date().toISOString() });
  });
}

/** Builds the books the first time a company opens them (companies that existed before accounting was added). */
export async function ensureGlBuilt(db: DB, firmId: number) {
  const s = await getSettings(db, firmId);
  if (!s.glBuiltAt) await rebuildGl(db, firmId);
}

// ─── Chart of accounts ───────────────────────────────────────────────────────

export async function listGlAccounts(db: D, firmId: number) {
  return db.select().from(glAccounts).where(eq(glAccounts.firmId, firmId)).orderBy(asc(glAccounts.code));
}

export const glAccountSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Enter the account name.").max(120),
  type: z.enum(ACCOUNT_TYPES),
  grp: z.string().trim().max(40).optional().transform((v) => v || null),
  active: z.boolean().default(true),
});

export async function saveGlAccount(db: DB, firmId: number, raw: z.input<typeof glAccountSchema>, userId: number) {
  const p = glAccountSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, "name");
  const { id, ...v } = p.data;
  const all = await listGlAccounts(db, firmId);
  if (all.some((a) => a.id !== id && a.name.toLowerCase() === v.name.toLowerCase())) throw new MasterError("An account with this name already exists.", "name");
  if (id) {
    const cur = all.find((a) => a.id === id);
    if (!cur) throw new MasterError("This account no longer exists.");
    if (cur.key) throw new MasterError("This account is maintained automatically. Rename the cash/bank account or category instead.");
    if (cur.type !== v.type) {
      const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(glEntries).where(eq(glEntries.accountId, id));
      if (used.n > 0) throw new MasterError("This account already has entries, so its type can't change.", "type");
    }
    await db.update(glAccounts).set({ name: v.name, type: v.type, grp: v.grp, active: v.active }).where(eq(glAccounts.id, id));
    await audit(db, { firmId, userId, action: "update", entity: "gl_account", entityId: id, summary: `Changed account ${v.name}` });
    return id;
  }
  const [row] = await db.insert(glAccounts).values({ ...v, firmId, code: await nextCode(db, firmId, v.type) }).returning({ id: glAccounts.id });
  await audit(db, { firmId, userId, action: "create", entity: "gl_account", entityId: row.id, summary: `Added account ${v.name}` });
  return row.id;
}

// ─── Manual journal entries ──────────────────────────────────────────────────

export const journalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date."),
  narration: z.string().trim().max(300).optional().transform((v) => v || null),
  lines: z
    .array(z.object({ accountId: z.number().int().positive(), debitPaise: z.number().int().min(0), creditPaise: z.number().int().min(0), memo: z.string().trim().max(200).optional() }))
    .min(2, "A journal entry needs at least two lines."),
});

export async function postJournal(db: DB, firmId: number, raw: z.input<typeof journalSchema>, userId: number) {
  const p = journalSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message);
  const j = p.data;
  for (const l of j.lines) {
    if ((l.debitPaise > 0) === (l.creditPaise > 0)) throw new MasterError("Each line needs either a debit or a credit amount, not both or neither.");
  }
  const dr = j.lines.reduce((s, l) => s + l.debitPaise, 0);
  const cr = j.lines.reduce((s, l) => s + l.creditPaise, 0);
  if (dr !== cr) throw new MasterError(`Debits and credits must be equal (now ${dr / 100} and ${cr / 100}).`);
  const ids = [...new Set(j.lines.map((l) => l.accountId))];
  const own = await db.select({ id: glAccounts.id }).from(glAccounts).where(and(eq(glAccounts.firmId, firmId), inArray(glAccounts.id, ids), eq(glAccounts.active, true)));
  if (own.length !== ids.length) throw new MasterError("Choose accounts from this company's chart of accounts.");
  return db.transaction(async (tx) => {
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${journals.number}), 0)::int` }).from(journals).where(eq(journals.firmId, firmId));
    const [row] = await tx.insert(journals).values({ firmId, number: max + 1, date: j.date, narration: j.narration, createdBy: userId }).returning({ id: journals.id, number: journals.number });
    await tx.insert(glEntries).values(j.lines.map((l) => ({ firmId, date: j.date, accountId: l.accountId, debitPaise: l.debitPaise, creditPaise: l.creditPaise, source: "journal" as const, journalId: row.id, memo: l.memo ?? j.narration })));
    await audit(tx, { firmId, userId, action: "create", entity: "journal", entityId: row.id, summary: `Journal entry ${row.number}: ${j.narration ?? ""} (${(dr / 100).toFixed(2)})` });
    return row;
  });
}

export async function deleteJournal(db: DB, firmId: number, id: number, userId: number) {
  const [j] = await db.select().from(journals).where(and(eq(journals.id, id), eq(journals.firmId, firmId)));
  if (!j) return;
  await db.delete(journals).where(eq(journals.id, id));
  await audit(db, { firmId, userId, action: "delete", entity: "journal", entityId: id, summary: `Deleted journal entry ${j.number}` });
}

export async function listJournals(db: DB, firmId: number, limit = 200) {
  const list = await db.select().from(journals).where(eq(journals.firmId, firmId)).orderBy(sql`${journals.date} desc, ${journals.id} desc`).limit(limit);
  if (list.length === 0) return [];
  const lines = await db
    .select({ journalId: glEntries.journalId, name: glAccounts.name, debit: glEntries.debitPaise, credit: glEntries.creditPaise })
    .from(glEntries)
    .innerJoin(glAccounts, eq(glAccounts.id, glEntries.accountId))
    .where(inArray(glEntries.journalId, list.map((j) => j.id)));
  return list.map((j) => ({ ...j, lines: lines.filter((l) => l.journalId === j.id), totalPaise: lines.filter((l) => l.journalId === j.id).reduce((s, l) => s + l.debit, 0) }));
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface TrialRow {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  grp: string | null;
  debit: number;
  credit: number;
  /** debit minus credit */
  net: number;
}

/** Balance of every account up to and including `asOf` (optionally only from `from`). */
export async function trialBalance(db: D, firmId: number, asOf: string, from?: string): Promise<TrialRow[]> {
  const rows = await db
    .select({
      id: glAccounts.id,
      code: glAccounts.code,
      name: glAccounts.name,
      type: glAccounts.type,
      grp: glAccounts.grp,
      debit: sql<number>`coalesce(sum(${glEntries.debitPaise}), 0)::bigint`,
      credit: sql<number>`coalesce(sum(${glEntries.creditPaise}), 0)::bigint`,
    })
    .from(glAccounts)
    .leftJoin(glEntries, and(eq(glEntries.accountId, glAccounts.id), lte(glEntries.date, asOf), from ? gte(glEntries.date, from) : undefined))
    .where(eq(glAccounts.firmId, firmId))
    .groupBy(glAccounts.id)
    .orderBy(asc(glAccounts.code));
  return rows
    .map((r) => ({ ...r, type: r.type as AccountType, debit: Number(r.debit), credit: Number(r.credit), net: Number(r.debit) - Number(r.credit) }))
    .filter((r) => r.debit !== 0 || r.credit !== 0);
}

export async function accountLedger(db: D, firmId: number, accountId: number, from: string, to: string) {
  const [acc] = await db.select().from(glAccounts).where(and(eq(glAccounts.id, accountId), eq(glAccounts.firmId, firmId)));
  if (!acc) return null;
  const [open] = await db
    .select({ d: sql<number>`coalesce(sum(${glEntries.debitPaise}), 0)::bigint`, c: sql<number>`coalesce(sum(${glEntries.creditPaise}), 0)::bigint` })
    .from(glEntries)
    .where(and(eq(glEntries.accountId, accountId), sql`${glEntries.date} < ${from}`));
  const entries = await db
    .select({ id: glEntries.id, date: glEntries.date, debit: glEntries.debitPaise, credit: glEntries.creditPaise, memo: glEntries.memo, source: glEntries.source, voucherId: glEntries.voucherId, journalId: glEntries.journalId, vType: vouchers.type, vPrefix: vouchers.prefix, vNumber: vouchers.number, partyName: vouchers.partyName })
    .from(glEntries)
    .leftJoin(vouchers, eq(vouchers.id, glEntries.voucherId))
    .where(and(eq(glEntries.accountId, accountId), gte(glEntries.date, from), lte(glEntries.date, to)))
    .orderBy(asc(glEntries.date), asc(glEntries.id));
  let running = Number(open.d) - Number(open.c);
  const opening = running;
  const list = entries.map((e) => {
    running += e.debit - e.credit;
    return { ...e, balance: running };
  });
  return { account: acc, openingNet: opening, entries: list, closingNet: running };
}

export interface BalanceSheet {
  asOf: string;
  assets: { grp: string; rows: { name: string; amount: number }[]; total: number }[];
  liabilities: { grp: string; rows: { name: string; amount: number }[]; total: number }[];
  equity: { name: string; amount: number }[];
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  profit: number;
  closingStock: number;
}

function group(rows: { name: string; grp: string | null; amount: number }[], fallback: string) {
  const m = new Map<string, { name: string; amount: number }[]>();
  for (const r of rows) {
    if (r.amount === 0) continue;
    const g = r.grp ?? fallback;
    m.set(g, [...(m.get(g) ?? []), { name: r.name, amount: r.amount }]);
  }
  return [...m.entries()].map(([grp, rs]) => ({ grp, rows: rs, total: rs.reduce((s, r) => s + r.amount, 0) }));
}

/** Balance sheet as of a date. `closingStock` is the value of stock on hand, which the periodic method keeps outside the ledger. */
export async function balanceSheet(db: D, firmId: number, asOf: string, closingStock: number): Promise<BalanceSheet> {
  const tb = await trialBalance(db, firmId, asOf);
  const asset = tb.filter((r) => r.type === "asset").map((r) => ({ name: r.name, grp: r.grp, amount: r.net }));
  const liab = tb.filter((r) => r.type === "liability").map((r) => ({ name: r.name, grp: r.grp, amount: -r.net }));
  const equity = tb.filter((r) => r.type === "equity").map((r) => ({ name: r.name, amount: -r.net })).filter((r) => r.amount !== 0);
  const income = tb.filter((r) => r.type === "income").reduce((s, r) => s - r.net, 0);
  const expense = tb.filter((r) => r.type === "expense").reduce((s, r) => s + r.net, 0);
  const profit = income - expense + closingStock;
  const assets = group(asset, "Other assets");
  if (closingStock !== 0) assets.push({ grp: "Stock", rows: [{ name: "Closing stock (at cost)", amount: closingStock }], total: closingStock });
  const liabilities = group(liab, "Other liabilities");
  const eq = [...equity, { name: "Profit up to this date", amount: profit }];
  const totalAssets = assets.reduce((s, g) => s + g.total, 0);
  const totalLE = liabilities.reduce((s, g) => s + g.total, 0) + eq.reduce((s, r) => s + r.amount, 0);
  return { asOf, assets, liabilities, equity: eq, totalAssets, totalLiabilitiesAndEquity: totalLE, profit, closingStock };
}

/** Total depreciation charged between two dates. */
export async function depreciationBetween(db: D, firmId: number, from: string, to: string) {
  const id = await ensureAccount(db, firmId, "depreciation");
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${glEntries.debitPaise} - ${glEntries.creditPaise}), 0)::bigint` })
    .from(glEntries)
    .where(and(eq(glEntries.accountId, id), gte(glEntries.date, from), lte(glEntries.date, to)));
  return Number(r.n);
}

// ─── Fixed assets ────────────────────────────────────────────────────────────

export const assetSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Enter the asset's name.").max(150),
  category: z.string().trim().min(1).max(60).default("Equipment"),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the purchase date."),
  costPaise: z.number().int().positive("Enter what it cost."),
  salvagePaise: z.number().int().min(0).default(0),
  method: z.enum(["straight_line", "reducing"]).default("straight_line"),
  rateBp: z.number().int().min(1, "Enter the yearly depreciation rate.").max(10000),
  paidFromAccountId: z.number().int().positive().nullish(),
  notes: z.string().trim().max(300).optional().transform((v) => v || null),
});

async function postAssetPurchase(db: D, firmId: number, a: typeof fixedAssets.$inferSelect) {
  await db.delete(glEntries).where(and(eq(glEntries.firmId, firmId), eq(glEntries.refKey, `asset:${a.id}:buy`), eq(glEntries.source, "asset")));
  const lines: GlLine[] = [
    { key: `fa:${a.category}`, debit: a.costPaise, credit: 0, memo: a.name },
    a.paidFromAccountId ? { key: `money:${a.paidFromAccountId}`, debit: 0, credit: a.costPaise, memo: a.name } : { key: "obe", debit: 0, credit: a.costPaise, memo: `${a.name} (already owned)` },
  ];
  await insertLines(db, firmId, a.purchaseDate, lines, { source: "asset", refKey: `asset:${a.id}:buy` });
}

export async function saveAsset(db: DB, firmId: number, raw: z.input<typeof assetSchema>, userId: number) {
  const p = assetSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const a = p.data;
  if (a.salvagePaise >= a.costPaise) throw new MasterError("The scrap value must be less than the cost.", "salvagePaise");
  if (a.paidFromAccountId) {
    const [acc] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, a.paidFromAccountId), eq(accounts.firmId, firmId)));
    if (!acc) throw new MasterError("Choose a cash or bank account from this company.");
  }
  return db.transaction(async (tx) => {
    let id = a.id;
    if (id) {
      const [cur] = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.firmId, firmId)));
      if (!cur) throw new MasterError("This asset no longer exists.");
      const [dep] = await tx.select({ n: sql<number>`count(*)::int` }).from(glEntries).where(and(eq(glEntries.firmId, firmId), sql`${glEntries.refKey} like ${`asset:${id}:dep:%`}`));
      if (dep.n > 0 && (cur.costPaise !== a.costPaise || cur.purchaseDate !== a.purchaseDate || cur.method !== a.method || cur.rateBp !== a.rateBp || cur.salvagePaise !== a.salvagePaise)) {
        throw new MasterError("Depreciation has already been posted for this asset, so its cost, date, method and rate can't change.");
      }
      await tx.update(fixedAssets).set({ name: a.name, category: a.category, purchaseDate: a.purchaseDate, costPaise: a.costPaise, salvagePaise: a.salvagePaise, method: a.method, rateBp: a.rateBp, paidFromAccountId: a.paidFromAccountId ?? null, notes: a.notes }).where(eq(fixedAssets.id, id));
    } else {
      [{ id }] = await tx.insert(fixedAssets).values({ firmId, name: a.name, category: a.category, purchaseDate: a.purchaseDate, costPaise: a.costPaise, salvagePaise: a.salvagePaise, method: a.method, rateBp: a.rateBp, paidFromAccountId: a.paidFromAccountId ?? null, notes: a.notes }).returning({ id: fixedAssets.id });
    }
    const [row] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id!));
    await postAssetPurchase(tx, firmId, row);
    await audit(tx, { firmId, userId, action: a.id ? "update" : "create", entity: "fixed_asset", entityId: id!, summary: `${a.id ? "Changed" : "Added"} fixed asset ${a.name}` });
    return id!;
  });
}

export async function listAssets(db: D, firmId: number) {
  const list = await db.select().from(fixedAssets).where(eq(fixedAssets.firmId, firmId)).orderBy(asc(fixedAssets.purchaseDate), asc(fixedAssets.id));
  const dep = await db
    .select({ ref: glEntries.refKey, amount: sql<number>`sum(${glEntries.debitPaise})::bigint` })
    .from(glEntries)
    .where(and(eq(glEntries.firmId, firmId), sql`${glEntries.refKey} like 'asset:%:dep:%'`))
    .groupBy(glEntries.refKey);
  const accumulated = new Map<number, number>();
  for (const d of dep) {
    const id = Number(d.ref!.split(":")[1]);
    accumulated.set(id, (accumulated.get(id) ?? 0) + Number(d.amount));
  }
  return list.map((a) => ({ ...a, accumulatedPaise: accumulated.get(a.id) ?? 0, bookValuePaise: a.costPaise - (accumulated.get(a.id) ?? 0) }));
}

/** Financial years (start dates) that still need depreciation posted for at least one asset, up to and including the year containing `today`. */
export async function pendingDepreciationYears(db: D, firmId: number, today: string) {
  const assets = (await listAssets(db, firmId)).filter((a) => !a.disposedOn);
  if (assets.length === 0) return [];
  const posted = await db.select({ ref: glEntries.refKey }).from(glEntries).where(and(eq(glEntries.firmId, firmId), sql`${glEntries.refKey} like 'asset:%:dep:%'`));
  const done = new Set(posted.map((p) => p.ref));
  const years = new Map<string, { label: string; from: string; to: string; assets: number }>();
  for (const a of assets) {
    let fy = financialYear(a.purchaseDate);
    while (fy.from <= today) {
      if (!done.has(`asset:${a.id}:dep:${fy.from}`)) {
        const y = years.get(fy.from) ?? { label: fy.label, from: fy.from, to: fy.to, assets: 0 };
        y.assets++;
        years.set(fy.from, y);
      }
      fy = financialYear(addDays(fy.to, 1));
    }
  }
  return [...years.values()].sort((a, b) => a.from.localeCompare(b.from));
}

/** Posts depreciation for one financial year for every asset that hasn't had it yet. Returns how many entries were made. */
export async function runDepreciation(db: DB, firmId: number, fyFrom: string, userId: number) {
  const fy = financialYear(fyFrom);
  if (fy.from !== fyFrom) throw new MasterError("Choose a financial year.");
  return db.transaction(async (tx) => {
    const assets = (await listAssets(tx, firmId)).filter((a) => !a.disposedOn || a.disposedOn >= fy.from);
    let posted = 0;
    for (const a of assets) {
      const key = `asset:${a.id}:dep:${fy.from}`;
      const [already] = await tx.select({ id: glEntries.id }).from(glEntries).where(and(eq(glEntries.firmId, firmId), eq(glEntries.refKey, key))).limit(1);
      if (already) continue;
      const amt = depreciationForYear(
        { costPaise: a.costPaise, salvagePaise: a.salvagePaise, method: a.method as "straight_line" | "reducing", rateBp: a.rateBp, purchaseDate: a.purchaseDate, disposedOn: a.disposedOn },
        fy.from,
        fy.to,
        a.accumulatedPaise,
      );
      // A zero entry is still recorded so the year isn't offered again.
      if (amt === 0) {
        await tx.insert(glEntries).values({ firmId, date: fy.to, accountId: await ensureAccount(tx, firmId, "depreciation"), debitPaise: 0, creditPaise: 0, source: "asset", refKey: key, memo: a.name });
        continue;
      }
      await insertLines(tx, firmId, fy.to, [{ key: "depreciation", debit: amt, credit: 0, memo: a.name }, { key: "accum_dep", debit: 0, credit: amt, memo: a.name }], { source: "asset", refKey: key });
      posted++;
    }
    await audit(tx, { firmId, userId, action: "create", entity: "depreciation", summary: `Posted depreciation for ${fy.label} on ${posted} asset${posted === 1 ? "" : "s"}` });
    return posted;
  });
}

/** Marks an asset sold or scrapped and records the gain or loss. Proceeds go to the chosen cash/bank account. */
export async function disposeAsset(db: DB, firmId: number, assetId: number, input: { date: string; proceedsPaise: number; accountId: number | null }, userId: number) {
  return db.transaction(async (tx) => {
    const list = await listAssets(tx, firmId);
    const a = list.find((x) => x.id === assetId);
    if (!a) throw new MasterError("This asset no longer exists.");
    if (a.disposedOn) throw new MasterError("This asset has already been sold or scrapped.");
    if (input.date < a.purchaseDate) throw new MasterError("The sale date can't be before the purchase date.");
    if (input.proceedsPaise > 0 && !input.accountId) throw new MasterError("Choose where the money came in.");
    if (input.accountId) {
      const [acc] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.firmId, firmId)));
      if (!acc) throw new MasterError("Choose a cash or bank account from this company.");
    }
    const book = a.bookValuePaise;
    const gain = input.proceedsPaise - book;
    const lines: GlLine[] = [];
    if (input.proceedsPaise > 0) lines.push({ key: `money:${input.accountId}`, debit: input.proceedsPaise, credit: 0, memo: `Sale of ${a.name}` });
    if (a.accumulatedPaise > 0) lines.push({ key: "accum_dep", debit: a.accumulatedPaise, credit: 0 });
    lines.push({ key: `fa:${a.category}`, debit: 0, credit: a.costPaise, memo: a.name });
    if (gain > 0) lines.push({ key: "asset_disposal", debit: 0, credit: gain, memo: `Gain on ${a.name}` });
    if (gain < 0) lines.push({ key: "asset_disposal", debit: -gain, credit: 0, memo: `Loss on ${a.name}` });
    await insertLines(tx, firmId, input.date, lines, { source: "asset", refKey: `asset:${assetId}:sale` });
    await tx.update(fixedAssets).set({ disposedOn: input.date, disposalPaise: input.proceedsPaise }).where(eq(fixedAssets.id, assetId));
    await audit(tx, { firmId, userId, action: "update", entity: "fixed_asset", entityId: assetId, summary: `Sold or scrapped ${a.name} for ${(input.proceedsPaise / 100).toFixed(2)}` });
  });
}

export async function companyCountry(db: D, firmId: number) {
  const [f] = await db.select({ country: firms.country }).from(firms).where(eq(firms.id, firmId));
  return f?.country === "SA" ? "SA" : "IN";
}
