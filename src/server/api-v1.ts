import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { accounts, firms, items, ledgerCategories, locations, moneyLedger, parties, taxRates, units, vouchers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { setRegion } from "@/lib/region";
import { addDays } from "@/lib/dates";
import { VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import type { VoucherType } from "@/db/schema";
import { saveCategoryName } from "./categories";
import { MasterError } from "./errors";
import { syncVoucherGl } from "./gl";
import { saveAccount, saveItem, saveParty, saveUnit } from "./masters";
import { saveVoucher, VoucherError } from "./vouchers";

/*
 * The bookkeeping API: a program (with an API key for one company) sends a batch of entries read from
 * purchase bills and bank statements; each is saved through the app's own rules (saveVoucher, saveItem,
 * saveParty, saveAccount), so tax, stock, ledgers and the books come out exactly as if typed.
 *
 * - The whole batch is one transaction: if any entry fails, nothing is kept. A dry run checks every
 *   entry the same way and then keeps nothing.
 * - Every bill or payment carries the caller's `ref`; one already entered is skipped, so sending the
 *   same batch again is safe. Suppliers, items and accounts are matched by GSTIN, Product ID or name.
 * - A dry run also lists hand-made entries that look like the same thing (same amount, close date).
 * Money is in paise (whole numbers); quantities are plain numbers ("2.5").
 */

export interface ApiContext {
  firmId: number;
  userId: number;
  keyName: string;
  /** How the activity log names the source, e.g. "Via Telegram (sent by …)". Defaults to the API key's name. */
  via?: string;
}

const ref = z.string().trim().min(1, "Every entry needs a ref.").max(120);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-14.");
const paise = z.number().int("Amounts are whole paise.").min(0);
const positivePaise = paise.positive("The amount must be more than zero.");
const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const pick = (what: string) =>
  z
    .object({ ref: z.string().optional(), id: z.number().int().positive().optional(), name: z.string().trim().optional(), gstin: z.string().trim().optional(), code: z.string().trim().optional() })
    .refine((p) => p.ref || p.id || p.name || p.gstin || p.code, `Say which ${what} (ref, id, name${what === "item" ? " or code" : what === "party" ? " or GSTIN" : ""}).`);

const entrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bank_account"), ref, name: z.string().trim().min(1).max(120), bankName: text(120), accountNo: text(40), ifsc: text(11), openingBalancePaise: z.number().int().default(0), openingDate: date }),
  z.object({ kind: z.literal("party"), ref, name: z.string().trim().min(1).max(200), partyKind: z.enum(["supplier", "customer", "both"]).default("supplier"), gstin: text(15), phone: text(30), address: text(1000), stateCode: text(2) }),
  z.object({
    kind: z.literal("item"),
    ref,
    name: z.string().trim().min(1).max(200),
    code: text(60),
    itemKind: z.enum(["goods", "service"]).default("goods"),
    hsn: text(10),
    unit: text(30),
    gstRatePct: z.number().min(0).max(100).optional().nullable(),
    purchasePricePaise: paise.default(0),
    salePricePaise: paise.default(0),
  }),
  z.object({
    kind: z.literal("purchase_bill"),
    ref,
    date,
    dueDate: date.optional().nullable(),
    party: pick("party"),
    billNo: z.string().trim().min(1, "Give the supplier's bill number.").max(60),
    lines: z
      .array(
        z.object({
          item: pick("item"),
          qty: z.number().positive("Quantities must be more than zero."),
          ratePaise: paise,
          rateIncludesTax: z.boolean().default(false),
          gstRatePct: z.number().min(0).max(100).optional().nullable(),
          discountPct: z.number().min(0).max(100).default(0),
        }),
      )
      .min(1, "A purchase bill needs at least one line.")
      .max(500),
    /** The total printed on the bill. If the app's sum differs, the entry is refused rather than guessed. */
    expectedTotalPaise: paise.optional().nullable(),
    roundOff: z.boolean().default(true),
    notes: text(2000),
    /** Paid in full at once from this cash/bank account. Without it the bill is entered unpaid. */
    paidFrom: pick("account").optional().nullable(),
    paymentMode: text(30),
  }),
  z.object({ kind: z.literal("expense"), ref, date, category: z.string().trim().min(1).max(120), amountPaise: positivePaise, account: pick("account"), payee: text(200), party: pick("party").optional().nullable(), paymentMode: text(30), paymentRef: text(100), note: text(2000) }),
  z.object({ kind: z.literal("other_income"), ref, date, category: z.string().trim().min(1).max(120), amountPaise: positivePaise, account: pick("account"), payer: text(200), paymentMode: text(30), paymentRef: text(100), note: text(2000) }),
  z.object({ kind: z.literal("payment_out"), ref, date, party: pick("party"), amountPaise: positivePaise, account: pick("account"), paymentMode: text(30), paymentRef: text(100), note: text(2000) }),
  z.object({ kind: z.literal("payment_in"), ref, date, party: pick("party"), amountPaise: positivePaise, account: pick("account"), paymentMode: text(30), paymentRef: text(100), note: text(2000) }),
  z.object({ kind: z.literal("transfer"), ref, date, from: pick("account"), to: pick("account"), amountPaise: positivePaise, note: text(2000) }),
  z.object({
    kind: z.literal("relink"),
    ref,
    /** The existing entry: its id, or its number as shown (e.g. "EXP-12"). */
    voucher: z.object({ id: z.number().int().positive().optional(), number: z.string().trim().optional() }).refine((v) => v.id || v.number, "Say which entry (id or number)."),
    account: pick("account"),
    paymentMode: text(30),
  }),
]);

export const batchSchema = z.object({
  dryRun: z.boolean().default(true),
  entries: z.array(z.unknown()).min(1, "Send at least one entry.").max(500, "Send at most 500 entries at a time."),
});

type Entry = z.infer<typeof entrySchema>;
type Pick = { ref?: string; id?: number; name?: string; gstin?: string; code?: string };

export interface EntryResult {
  ref: string;
  kind: string;
  status: "created" | "would_create" | "already_entered" | "changed" | "would_change" | "error";
  id?: number;
  number?: string;
  link?: string;
  /** Bills and payments: the total as the app worked it out. */
  totalPaise?: number;
  message?: string;
  possibleDuplicates?: { id: number; number: string; type: string; date: string; amountPaise: number; party: string | null; link: string }[];
}

class Rollback extends Error {}

/** What a program needs to match documents to the company's records. */
export async function apiReference(db: DB, firmId: number) {
  const [acc, cats, ps, its, rates, locs] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name, kind: accounts.kind, bankName: accounts.bankName, accountNo: accounts.accountNo, active: accounts.active }).from(accounts).where(eq(accounts.firmId, firmId)).orderBy(asc(accounts.id)),
    db.select({ id: ledgerCategories.id, kind: ledgerCategories.kind, name: ledgerCategories.name }).from(ledgerCategories).where(eq(ledgerCategories.firmId, firmId)).orderBy(asc(ledgerCategories.name)),
    db.select({ id: parties.id, name: parties.name, kind: parties.kind, gstin: parties.gstin, phone: parties.phone, stateCode: parties.stateCode }).from(parties).where(eq(parties.firmId, firmId)).orderBy(asc(parties.name)),
    db
      .select({ id: items.id, code: items.code, name: items.name, kind: items.kind, hsn: items.hsn, unit: units.code, gstBp: taxRates.gstBp, purchasePricePaise: items.purchasePricePaise, active: items.active })
      .from(items)
      .leftJoin(units, eq(units.id, items.unitId))
      .leftJoin(taxRates, eq(taxRates.id, items.taxRateId))
      .where(eq(items.firmId, firmId))
      .orderBy(asc(items.name)),
    db.select({ id: taxRates.id, name: taxRates.name, gstBp: taxRates.gstBp, nature: taxRates.nature }).from(taxRates).where(and(eq(taxRates.firmId, firmId), eq(taxRates.active, true))),
    db.select({ id: locations.id, name: locations.name, kind: locations.kind }).from(locations).where(and(eq(locations.firmId, firmId), eq(locations.active, true), sql`${locations.kind} in ('warehouse', 'shop')`)),
  ]);
  return { accounts: acc, categories: cats, parties: ps, items: its, taxRates: rates, locations: locs };
}

/** Runs a batch. Returns one result per entry; `ok` is false when any entry failed (then nothing was kept). */
export async function runBatch(db: DB, ctx: ApiContext, raw: unknown): Promise<{ ok: boolean; dryRun: boolean; results: EntryResult[] }> {
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success) throw new MasterError(parsed.error.issues[0].message);
  const { dryRun } = parsed.data;
  // Tax and ID rules (GSTIN vs VAT number, ...) follow the company's own country. That setting is shared by the whole
  // server process, so it's set here from the company, not left to whatever page was last opened (and again per entry).
  const [firm] = await db.select({ country: firms.country }).from(firms).where(eq(firms.id, ctx.firmId));
  if (!firm) throw new MasterError("That company no longer exists.");
  const country = firm.country;
  let out: { ok: boolean; dryRun: boolean; results: EntryResult[] } = { ok: false, dryRun, results: [] };

  try {
    await db.transaction(async (tx0) => {
      const tx = tx0 as unknown as DB;
      const results: EntryResult[] = [];
      const seenRefs = new Set<string>();
      const byRef = { party: new Map<string, number>(), item: new Map<string, number>(), account: new Map<string, number>() };

      for (const [i, rawEntry] of parsed.data.entries.entries()) {
        const p = entrySchema.safeParse(rawEntry);
        const label = (rawEntry as { ref?: unknown })?.ref;
        if (!p.success) {
          const iss = p.error.issues[0];
          results.push({ ref: typeof label === "string" ? label : `#${i + 1}`, kind: String((rawEntry as { kind?: unknown })?.kind ?? "?"), status: "error", message: `${iss.message}${iss.path.length ? ` (${iss.path.join(".")})` : ""}` });
          continue;
        }
        const e = p.data;
        if (seenRefs.has(e.ref)) {
          results.push({ ref: e.ref, kind: e.kind, status: "error", message: "This ref appears twice in the batch." });
          continue;
        }
        seenRefs.add(e.ref);
        try {
          setRegion(country);
          results.push(await runEntry(tx, ctx, e, byRef, dryRun));
        } catch (err) {
          if (err instanceof MasterError || err instanceof VoucherError) results.push({ ref: e.ref, kind: e.kind, status: "error", message: err.message });
          else throw err;
        }
      }

      const ok = results.every((r) => r.status !== "error");
      out = { ok, dryRun, results };
      if (ok && !dryRun) {
        const made = results.filter((r) => r.status === "created" || r.status === "changed").length;
        const skipped = results.filter((r) => r.status === "already_entered").length;
        await audit(tx, {
          firmId: ctx.firmId,
          userId: ctx.userId,
          action: "create",
          entity: "api_batch",
          summary: `${ctx.via ?? `Via API key "${ctx.keyName}"`}: ${made} entered or changed, ${skipped} already there (refs ${results
            .slice(0, 5)
            .map((r) => r.ref)
            .join(", ")}${results.length > 5 ? ", …" : ""})`,
        });
      }
      // A dry run, or a batch with any error, keeps nothing.
      if (!ok || dryRun) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out;
}

type RefMaps = { party: Map<string, number>; item: Map<string, number>; account: Map<string, number> };

async function runEntry(db: DB, ctx: ApiContext, e: Entry, byRef: RefMaps, dryRun: boolean): Promise<EntryResult> {
  const f = ctx.firmId;
  const base = { ref: e.ref, kind: e.kind };
  const made = dryRun ? ("would_create" as const) : ("created" as const);

  switch (e.kind) {
    case "bank_account": {
      const [have] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, f), sql`lower(${accounts.name}) = lower(${e.name})`));
      if (have) {
        byRef.account.set(e.ref, have.id);
        return { ...base, status: "already_entered", id: have.id, message: "An account with this name exists." };
      }
      const id = await saveAccount(db, f, { kind: "bank", name: e.name, bankName: e.bankName, accountNo: e.accountNo, ifsc: e.ifsc, openingBalancePaise: e.openingBalancePaise, openingDate: e.openingDate }, ctx.userId);
      byRef.account.set(e.ref, id);
      return { ...base, status: made, id };
    }

    case "party": {
      const gstin = e.gstin?.toUpperCase() ?? null;
      const [have] = await db
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.firmId, f), gstin ? sql`(upper(${parties.gstin}) = ${gstin} or lower(${parties.name}) = lower(${e.name}))` : sql`lower(${parties.name}) = lower(${e.name})`))
        .limit(1);
      if (have) {
        byRef.party.set(e.ref, have.id);
        return { ...base, status: "already_entered", id: have.id, message: "Matched an existing party by GSTIN or name." };
      }
      const stateCode = e.stateCode ?? (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null);
      const id = await saveParty(db, f, { kind: e.partyKind, name: e.name, gstin, phone: e.phone, billingAddress: e.address, stateCode }, ctx.userId);
      byRef.party.set(e.ref, id);
      return { ...base, status: made, id };
    }

    case "item": {
      const [have] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.firmId, f), e.code ? sql`(lower(${items.code}) = lower(${e.code}) or lower(${items.name}) = lower(${e.name}))` : sql`lower(${items.name}) = lower(${e.name})`))
        .limit(1);
      if (have) {
        byRef.item.set(e.ref, have.id);
        return { ...base, status: "already_entered", id: have.id, message: "Matched an existing item by Product ID or name." };
      }
      const id = await saveItem(
        db,
        f,
        {
          kind: e.itemKind,
          name: e.name,
          code: e.code,
          hsn: e.hsn,
          unitId: e.unit ? await unitId(db, f, e.unit) : null,
          taxRateId: e.gstRatePct != null ? await taxRateId(db, f, e.gstRatePct) : null,
          purchasePricePaise: e.purchasePricePaise,
          salePricePaise: e.salePricePaise,
        },
        ctx.userId,
      );
      byRef.item.set(e.ref, id);
      return { ...base, status: made, id };
    }

    case "relink":
      return relink(db, ctx, e, byRef, dryRun);
  }

  // Bills and payments: skipped when the same ref was entered before.
  const [already] = await db.select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, status: vouchers.status }).from(vouchers).where(and(eq(vouchers.firmId, f), eq(vouchers.externalRef, e.ref)));
  if (already) {
    return { ...base, status: "already_entered", id: already.id, number: voucherNumber(already), link: linkOf(already.type, already.id), message: already.status === "active" ? undefined : `Entered before, now ${already.status}.` };
  }

  let input: Parameters<typeof saveVoucher>[2];
  let amount = 0;
  switch (e.kind) {
    case "purchase_bill": {
      const partyId = await resolveParty(db, f, e.party, byRef);
      const lines = [];
      for (const l of e.lines) {
        const it = await resolveItem(db, f, l.item, byRef);
        const tax = l.gstRatePct != null ? await taxRateId(db, f, l.gstRatePct) : it.taxRateId;
        const t = tax ? (await db.select().from(taxRates).where(eq(taxRates.id, tax)))[0] : undefined;
        lines.push({
          itemId: it.id,
          description: it.name,
          hsn: it.hsn,
          qtyMilli: Math.round(l.qty * 1000),
          ratePaise: l.ratePaise,
          rateIncludesTax: l.rateIncludesTax,
          discountBp: Math.round(l.discountPct * 100),
          taxRateId: t?.id ?? null,
          gstBp: t?.gstBp ?? 0,
          cessBp: t?.cessBp ?? 0,
        });
      }
      const paidFrom = e.paidFrom ? await resolveAccount(db, f, e.paidFrom, byRef) : null;
      input = {
        type: "purchase_bill",
        date: e.date,
        dueDate: e.dueDate,
        partyId,
        supplierInvoiceNo: e.billNo,
        roundOff: e.roundOff,
        notes: e.notes,
        // saveVoucher caps what's paid at the bill's total, so "everything" is any amount at least that big.
        paidPaise: paidFrom ? Number.MAX_SAFE_INTEGER : 0,
        accountId: paidFrom,
        paymentMode: paidFrom ? (e.paymentMode ?? "Cash") : null,
        lines,
      };
      break;
    }
    case "expense":
    case "other_income": {
      const accountId = await resolveAccount(db, f, e.account, byRef);
      const categoryId = await categoryOf(db, ctx, e.kind === "expense" ? "expense" : "income", e.category);
      const partyId = e.kind === "expense" && e.party ? await resolveParty(db, f, e.party, byRef) : null;
      const who = e.kind === "expense" ? e.payee : e.payer;
      amount = e.amountPaise;
      input = {
        type: e.kind,
        date: e.date,
        partyId,
        partyName: partyId ? null : who,
        categoryId,
        accountId,
        paidPaise: e.amountPaise,
        paymentMode: e.paymentMode ?? "Bank transfer",
        paymentRef: e.paymentRef,
        itcEligible: false,
        roundOff: false,
        notes: e.note,
        lines: [{ description: who ? `${e.category} — ${who}` : e.category, qtyMilli: 1000, ratePaise: e.amountPaise }],
      };
      break;
    }
    case "payment_out":
    case "payment_in": {
      const partyId = await resolveParty(db, f, e.party, byRef);
      const accountId = await resolveAccount(db, f, e.account, byRef);
      amount = e.amountPaise;
      input = { type: e.kind, date: e.date, partyId, accountId, amountPaise: e.amountPaise, paymentMode: e.paymentMode ?? "Bank transfer", paymentRef: e.paymentRef, notes: e.note };
      break;
    }
    case "transfer": {
      const accountId = await resolveAccount(db, f, e.from, byRef);
      const toAccountId = await resolveAccount(db, f, e.to, byRef);
      if (accountId === toAccountId) throw new MasterError("A transfer needs two different accounts.");
      amount = e.amountPaise;
      input = { type: "money_transfer", date: e.date, accountId, toAccountId, amountPaise: e.amountPaise, notes: e.note };
      break;
    }
  }

  const saved = await saveVoucher(db, f, { ...input, externalRef: e.ref }, ctx.userId);
  const [v] = await db.select({ type: vouchers.type, totalPaise: vouchers.totalPaise, date: vouchers.date, partyId: vouchers.partyId, supplierInvoiceNo: vouchers.supplierInvoiceNo }).from(vouchers).where(eq(vouchers.id, saved.id));
  if (e.kind === "purchase_bill") {
    if (e.expectedTotalPaise != null && v.totalPaise !== e.expectedTotalPaise) {
      throw new MasterError(`The bill adds up to ${(v.totalPaise / 100).toFixed(2)} in the app but ${(e.expectedTotalPaise / 100).toFixed(2)} is printed on it. Check the quantities, rates and tax.`);
    }
    amount = v.totalPaise;
  }
  const result: EntryResult = { ...base, status: made, id: saved.id, number: saved.number, link: linkOf(v.type, saved.id), totalPaise: v.totalPaise };
  const dupes = await lookAlikes(db, f, saved.id, v.type, v.date, amount, v.partyId, v.supplierInvoiceNo);
  if (dupes.length) result.possibleDuplicates = dupes;
  if (saved.warnings.length) result.message = saved.warnings.join(" ");
  return result;
}

/** Moves an existing entry to another cash/bank account (e.g. a salary recorded as cash that the bank statement shows was paid by bank). */
async function relink(db: DB, ctx: ApiContext, e: Extract<Entry, { kind: "relink" }>, byRef: RefMaps, dryRun: boolean): Promise<EntryResult> {
  const f = ctx.firmId;
  const base = { ref: e.ref, kind: e.kind };
  const rows = await db
    .select()
    .from(vouchers)
    .where(and(eq(vouchers.firmId, f), e.voucher.id ? eq(vouchers.id, e.voucher.id) : sql`lower(coalesce(${vouchers.prefix}, '') || ${vouchers.number}::text) = lower(${e.voucher.number})`));
  if (rows.length === 0) throw new MasterError("That entry doesn't exist in this company.");
  if (rows.length > 1) throw new MasterError(`More than one entry is numbered ${e.voucher.number}; give its id.`);
  const v = rows[0];
  if (v.status !== "active") throw new MasterError(`${voucherNumber(v)} is ${v.status}.`);
  if (!["expense", "other_income", "payment_in", "payment_out"].includes(v.type) || !v.accountId) throw new MasterError(`${voucherNumber(v)} isn't paid from an account, so there's nothing to move.`);
  const to = await resolveAccount(db, f, e.account, byRef);
  const link = linkOf(v.type, v.id);
  if (v.accountId === to) return { ...base, status: "already_entered", id: v.id, number: voucherNumber(v), link, message: "Already on that account." };
  const [from] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, v.accountId));
  const [target] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, to));
  await db.update(vouchers).set({ accountId: to, paymentMode: e.paymentMode ?? v.paymentMode, externalRef: v.externalRef ?? e.ref, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(vouchers.id, v.id));
  await db.update(moneyLedger).set({ accountId: to }).where(and(eq(moneyLedger.voucherId, v.id), eq(moneyLedger.accountId, v.accountId)));
  await syncVoucherGl(db, f, v.id);
  await audit(db, { firmId: f, userId: ctx.userId, action: "update", entity: "voucher", entityId: v.id, summary: `Moved ${voucherNumber(v)} from ${from?.name ?? "?"} to ${target?.name ?? "?"} (${(ctx.via ?? `via API key "${ctx.keyName}"`).replace(/^V/, "v")})` });
  return { ...base, status: dryRun ? "would_change" : "changed", id: v.id, number: voucherNumber(v), link, message: `${from?.name ?? "?"} → ${target?.name ?? "?"}` };
}

/** Hand-made entries that look like this one: same amount within 3 days (or, for a purchase bill, the same supplier bill number). */
async function lookAlikes(db: DB, firmId: number, id: number, type: VoucherType, onDate: string, amount: number, partyId: number | null, billNo: string | null) {
  if (amount <= 0 && !billNo) return [];
  const family: VoucherType[] = type === "purchase_bill" ? ["purchase_bill", "expense"] : type === "payment_in" || type === "other_income" ? ["payment_in", "other_income"] : ["expense", "payment_out", "purchase_bill"];
  const rows = await db
    .select({ id: vouchers.id, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date, totalPaise: vouchers.totalPaise, partyName: vouchers.partyName })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.firmId, firmId),
        eq(vouchers.status, "active"),
        sql`${vouchers.id} <> ${id}`,
        sql`${vouchers.type} in (${sql.join(family.map((t) => sql`${t}`), sql`, `)})`,
        billNo && partyId
          ? sql`((${vouchers.partyId} = ${partyId} and lower(${vouchers.supplierInvoiceNo}) = lower(${billNo})) or (${vouchers.totalPaise} = ${amount} and ${vouchers.date} between ${addDays(onDate, -3)} and ${addDays(onDate, 3)}))`
          : sql`${vouchers.totalPaise} = ${amount} and ${vouchers.date} between ${addDays(onDate, -3)} and ${addDays(onDate, 3)}`,
      ),
    )
    .limit(5);
  return rows.map((r) => ({ id: r.id, number: voucherNumber(r), type: r.type, date: r.date, amountPaise: r.totalPaise, party: r.partyName, link: linkOf(r.type, r.id) }));
}

const linkOf = (type: VoucherType, id: number) => `${VOUCHER_INFO[type].path}/${id}`;

async function resolveParty(db: DB, f: number, p: Pick, byRef: RefMaps): Promise<number> {
  if (p.ref) {
    const id = byRef.party.get(p.ref);
    if (!id) throw new MasterError(`No party with ref "${p.ref}" earlier in this batch.`);
    return id;
  }
  const where = p.id ? eq(parties.id, p.id) : p.gstin ? sql`upper(${parties.gstin}) = upper(${p.gstin})` : sql`lower(${parties.name}) = lower(${p.name ?? ""})`;
  const [row] = await db.select({ id: parties.id }).from(parties).where(and(eq(parties.firmId, f), where)).limit(1);
  if (!row) throw new MasterError(`Party ${p.id ?? p.gstin ?? `"${p.name}"`} isn't in this company. Add it in the batch first.`);
  return row.id;
}

async function resolveItem(db: DB, f: number, p: Pick, byRef: RefMaps) {
  let id = p.ref ? byRef.item.get(p.ref) : undefined;
  if (p.ref && !id) throw new MasterError(`No item with ref "${p.ref}" earlier in this batch.`);
  const where = id ? eq(items.id, id) : p.id ? eq(items.id, p.id) : p.code ? sql`lower(${items.code}) = lower(${p.code})` : sql`lower(${items.name}) = lower(${p.name ?? ""})`;
  const [row] = await db.select({ id: items.id, name: items.name, hsn: items.hsn, taxRateId: items.taxRateId }).from(items).where(and(eq(items.firmId, f), where)).limit(1);
  if (!row) throw new MasterError(`Item ${p.id ?? p.code ?? `"${p.name}"`} isn't in this company. Add it in the batch first.`);
  id = row.id;
  return row;
}

async function resolveAccount(db: DB, f: number, p: Pick, byRef: RefMaps): Promise<number> {
  if (p.ref) {
    const id = byRef.account.get(p.ref);
    if (!id) throw new MasterError(`No account with ref "${p.ref}" earlier in this batch.`);
    return id;
  }
  const [row] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, f), p.id ? eq(accounts.id, p.id) : sql`lower(${accounts.name}) = lower(${p.name ?? ""})`)).limit(1);
  if (!row) throw new MasterError(`Account ${p.id ?? `"${p.name}"`} isn't in this company.`);
  return row.id;
}

/** The tax rate for "18" (%): the company's taxable rate of that size. */
async function taxRateId(db: DB, f: number, pct: number): Promise<number | null> {
  const bp = Math.round(pct * 100);
  const rows = await db.select().from(taxRates).where(and(eq(taxRates.firmId, f), eq(taxRates.active, true), eq(taxRates.gstBp, bp)));
  const hit = rows.find((r) => r.nature === "taxable") ?? rows[0];
  if (!hit) throw new MasterError(`There's no ${pct}% tax rate in this company. Add it under Settings → Tax rates first.`);
  return hit.id;
}

async function unitId(db: DB, f: number, code: string): Promise<number> {
  const [hit] = await db.select({ id: units.id }).from(units).where(and(eq(units.firmId, f), sql`(lower(${units.code}) = lower(${code}) or lower(${units.name}) = lower(${code}))`));
  if (hit) return hit.id;
  return saveUnit(db, f, { name: code, code: code.slice(0, 10), active: true });
}

/** An expense or income category by name, made the first time it's used. */
async function categoryOf(db: DB, ctx: ApiContext, kind: "expense" | "income", name: string): Promise<number> {
  const [hit] = await db.select({ id: ledgerCategories.id }).from(ledgerCategories).where(and(eq(ledgerCategories.firmId, ctx.firmId), eq(ledgerCategories.kind, kind), sql`lower(${ledgerCategories.name}) = lower(${name})`));
  if (hit) return hit.id;
  await saveCategoryName(db, ctx.firmId, kind, undefined, name, ctx.userId);
  const [made] = await db.select({ id: ledgerCategories.id }).from(ledgerCategories).where(and(eq(ledgerCategories.firmId, ctx.firmId), eq(ledgerCategories.kind, kind), sql`lower(${ledgerCategories.name}) = lower(${name})`));
  return made.id;
}
