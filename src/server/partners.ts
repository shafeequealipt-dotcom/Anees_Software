import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { firms, ledgerCategories, partnerPayoutLinks, partnerPayouts, partnerPromotions, partners, vouchers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { localDate, monthRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { compactViews, groupViews, nextInvoiceSequence, paymentToLine, payoutInvoiceNo, rupeesInWords, viewsAmountPaise } from "@/lib/payout";
import { nextProductId } from "@/lib/product-id";
import { getSettings, saveSettings } from "@/lib/settings";
import { imageDataUrls } from "./company-images";
import { MasterError } from "./errors";
import { monthLabel, monthSchema, shiftMonth } from "./staff";
import { saveVoucher, type SaveResult, VoucherError } from "./vouchers";

/*
 * Partners: content creators OrpheusMedia pays every month for their views. Built the way staff
 * salaries are: each payment is an ordinary expense (so cash, bank and profit & loss need nothing
 * extra) tagged with the partner and the month; the monthly sheet is worked out from those tags
 * plus the month's views, rate and promotions. Only for companies with the "Partners" switch on.
 */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

/** Every partner function starts here: the company must have Partners turned on. */
export async function assertPartnersEnabled(db: DB | Tx, firmId: number) {
  if (!(await getSettings(db, firmId)).partnersEnabled) throw new MasterError("Partners isn't turned on for this company.");
}

export async function partnersEnabled(db: DB | Tx, firmId: number) {
  return (await getSettings(db, firmId)).partnersEnabled;
}

/** The Owner turns Partners on or off for one company. */
export async function setPartnersEnabled(db: DB, firmId: number, enabled: boolean, userId: number) {
  const [f] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId));
  if (!f) throw new MasterError("That company no longer exists.");
  await saveSettings(db, firmId, { partnersEnabled: enabled });
  await audit(db, { firmId, userId, action: "settings", entity: "firm", entityId: firmId, summary: `${enabled ? "Turned on" : "Turned off"} Partners for "${f.name}"` });
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export const partnerSchema = z.object({
  id: z.number().int().positive().optional(),
  code: optText(60),
  name: z.string().trim().min(1, "Enter the partner's name.").max(120),
  channelName: optText(160),
  handle: optText(80),
  kind: z.enum(["national", "international"]),
  country: optText(80),
  address: optText(1000),
  pan: optText(20),
  phone: optText(30),
  email: z.string().trim().max(200).email("That email address doesn't look right.").nullish().or(z.literal("").transform(() => null)).transform((v) => v || null),
  instagram: optText(120),
  facebook: optText(120),
  telegram: optText(120),
  tiktok: optText(120),
  youtubeUrl: optText(300),
  ratePerMillionPaise: z.number().int().min(0, "The rate can't be negative.").max(1_000_000_000),
  bankHolder: optText(120),
  bankName: optText(120),
  bankAccountNo: optText(40),
  bankBranch: optText(120),
  bankIfsc: optText(15),
  upiId: optText(100),
  bankSwift: optText(15),
  bankIban: optText(40),
  bankAddress: optText(500),
  joinedOn: optDate,
  notes: optText(1000),
  active: z.boolean().default(true),
});

export async function savePartner(db: DB, firmId: number, raw: z.input<typeof partnerSchema>, userId: number) {
  await assertPartnersEnabled(db, firmId);
  const p = partnerSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const { id, code: typedCode, ...v } = p.data;
  // A national partner has no SWIFT/IBAN and an international one has no IFSC/UPI: drop what doesn't apply.
  if (v.kind === "national") Object.assign(v, { country: null, bankSwift: null, bankIban: null, bankAddress: null });
  else Object.assign(v, { bankIfsc: null, upiId: null });
  if (v.kind === "international" && !v.country) throw new MasterError("Enter the partner's country.", "country");

  return db.transaction(async (tx) => {
    // One partner save at a time per company: the ID check and the next automatic ID are then race-free.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`partner:${firmId}`}))`);
    let before: typeof partners.$inferSelect | undefined;
    if (id) {
      [before] = await tx.select().from(partners).where(and(eq(partners.id, id), eq(partners.firmId, firmId)));
      if (!before) throw new MasterError("This partner no longer exists.");
    }
    let code = typedCode;
    if (!code) {
      if (before) code = before.code;
      else code = nextProductId((await tx.select({ code: partners.code }).from(partners).where(eq(partners.firmId, firmId))).map((r) => r.code), { prefix: "", digits: 0 });
    }
    const [dupe] = await tx
      .select({ id: partners.id, name: partners.name })
      .from(partners)
      .where(and(eq(partners.firmId, firmId), sql`lower(${partners.code}) = lower(${code})`, id ? sql`${partners.id} <> ${id}` : sql`true`));
    if (dupe) throw new MasterError(`Partner ID "${code}" is already used by "${dupe.name}".`, "code");

    if (before) {
      await tx.update(partners).set({ ...v, code, updatedAt: new Date() }).where(eq(partners.id, before.id));
      const rateNote = before.ratePerMillionPaise !== v.ratePerMillionPaise ? ` (rate ${formatMoney(before.ratePerMillionPaise)} → ${formatMoney(v.ratePerMillionPaise)} per 10,00,000 views)` : "";
      await audit(tx, { firmId, userId, action: "update", entity: "partner", entityId: before.id, summary: `Updated partner ${v.name}${rateNote}` });
      return before.id;
    }
    const [row] = await tx.insert(partners).values({ ...v, code, firmId }).returning({ id: partners.id });
    await audit(tx, { firmId, userId, action: "create", entity: "partner", entityId: row.id, summary: `Added partner ${v.name} (${code})` });
    return row.id;
  });
}

export async function listPartners(db: DB, firmId: number, opts: { includeInactive?: boolean } = {}) {
  return db
    .select()
    .from(partners)
    .where(and(eq(partners.firmId, firmId), opts.includeInactive ? sql`true` : eq(partners.active, true)))
    .orderBy(asc(sql`lower(${partners.name})`));
}

export async function getPartner(db: DB | Tx, firmId: number, id: number) {
  const [p] = await db.select().from(partners).where(and(eq(partners.id, id), eq(partners.firmId, firmId)));
  return p ?? null;
}

/** What the next new partner would be called, for the form. */
export async function nextPartnerCode(db: DB, firmId: number) {
  return nextProductId((await db.select({ code: partners.code }).from(partners).where(eq(partners.firmId, firmId))).map((r) => r.code), { prefix: "", digits: 0 });
}

/** "Don't Miss Bollywood", or the person's name when there's no channel. */
export const payeeName = (p: { channelName: string | null; name: string }) => p.channelName || p.name;

// ─── The month sheet ─────────────────────────────────────────────────────────

export interface PartnerSheetRow {
  partnerId: number;
  code: string;
  name: string;
  channelName: string | null;
  kind: string;
  phone: string | null;
  active: boolean;
  ratePerMillionPaise: number;
  payoutId: number | null;
  views: number;
  /** The rate this month was worked out at. */
  rateUsedPaise: number;
  viewsAmountPaise: number;
  viewsDescription: string | null;
  promotions: { id: number; description: string; amountPaise: number }[];
  promotionsPaise: number;
  totalPaise: number;
  invoiceNo: string | null;
  invoiceDate: string | null;
  invoicePeriod: string | null;
  invoiceNotes: string | null;
  paidPaise: number;
  duePaise: number;
}

/** Everyone who was a partner at any point of the month, or was paid or invoiced for it, with what they're owed. */
export async function partnerSheet(db: DB, firmId: number, month: string) {
  monthSchema.parse(month);
  const { to } = monthRange(`${month}-01`);
  const all = await listPartners(db, firmId, { includeInactive: true });
  const payouts = await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.firmId, firmId), eq(partnerPayouts.month, month)));
  const payoutBy = new Map(payouts.map((p) => [p.partnerId, p]));
  const promos = payouts.length ? await db.select().from(partnerPromotions).where(inArray(partnerPromotions.payoutId, payouts.map((p) => p.id))).orderBy(asc(partnerPromotions.id)) : [];
  const paid = await db
    .select({ partnerId: vouchers.partnerId, total: sql<number>`sum(${vouchers.totalPaise})::bigint`.mapWith(Number) })
    .from(vouchers)
    .where(and(eq(vouchers.firmId, firmId), eq(vouchers.payMonth, month), eq(vouchers.status, "active"), sql`${vouchers.partnerId} is not null`))
    .groupBy(vouchers.partnerId);
  const paidBy = new Map(paid.map((r) => [r.partnerId!, r.total]));

  const rows: PartnerSheetRow[] = [];
  for (const p of all) {
    const payout = payoutBy.get(p.id);
    const touched = !!payout || paidBy.has(p.id);
    const inMonth = p.active && (!p.joinedOn || p.joinedOn <= to);
    if (!inMonth && !touched) continue;
    const mine = payout ? promos.filter((x) => x.payoutId === payout.id) : [];
    const promotionsPaise = mine.reduce((s, x) => s + x.amountPaise, 0);
    const totalPaise = (payout?.viewsAmountPaise ?? 0) + promotionsPaise;
    const paidPaise = paidBy.get(p.id) ?? 0;
    rows.push({
      partnerId: p.id,
      code: p.code,
      name: p.name,
      channelName: p.channelName,
      kind: p.kind,
      phone: p.phone,
      active: p.active,
      ratePerMillionPaise: p.ratePerMillionPaise,
      payoutId: payout?.id ?? null,
      views: payout?.views ?? 0,
      rateUsedPaise: payout?.ratePerMillionPaise ?? p.ratePerMillionPaise,
      viewsAmountPaise: payout?.viewsAmountPaise ?? 0,
      viewsDescription: payout?.viewsDescription ?? null,
      promotions: mine.map((x) => ({ id: x.id, description: x.description, amountPaise: x.amountPaise })),
      promotionsPaise,
      totalPaise,
      invoiceNo: payout?.invoiceNo ?? null,
      invoiceDate: payout?.invoiceDate ?? null,
      invoicePeriod: payout?.period ?? null,
      invoiceNotes: payout?.invoiceNotes ?? null,
      paidPaise,
      duePaise: totalPaise - paidPaise,
    });
  }
  const sum = (k: "totalPaise" | "paidPaise") => rows.reduce((s, r) => s + r[k], 0);
  return { month, rows, totals: { totalPaise: sum("totalPaise"), paidPaise: sum("paidPaise"), duePaise: rows.reduce((s, r) => s + Math.max(0, r.duePaise), 0) } };
}

/** The partner's month row, created (empty, at the partner's usual rate) the first time something is entered. */
async function payoutFor(tx: DB | Tx, firmId: number, partner: typeof partners.$inferSelect, month: string) {
  const [have] = await tx.select().from(partnerPayouts).where(and(eq(partnerPayouts.partnerId, partner.id), eq(partnerPayouts.month, month)));
  if (have) return have;
  const [row] = await tx
    .insert(partnerPayouts)
    .values({ firmId, partnerId: partner.id, month, ratePerMillionPaise: partner.ratePerMillionPaise })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [again] = await tx.select().from(partnerPayouts).where(and(eq(partnerPayouts.partnerId, partner.id), eq(partnerPayouts.month, month)));
  return again;
}

async function mustGetPartner(db: DB | Tx, firmId: number, id: number) {
  const p = await getPartner(db, firmId, id);
  if (!p) throw new MasterError("This partner no longer exists.");
  return p;
}

// ─── Views ───────────────────────────────────────────────────────────────────

export const viewsSchema = z.object({
  partnerId: z.number().int().positive(),
  month: monthSchema,
  views: z.number().int().min(0, "Views can't be negative.").max(1_000_000_000_000, "That's too many views."),
  /** Left out, it's the rate this month already has, or the partner's own rate. */
  ratePerMillionPaise: z.number().int().min(0, "The rate can't be negative.").max(1_000_000_000).nullish(),
  /** Left out, it's worked out as views × rate. Give it to correct the amount by hand. */
  amountPaise: z.number().int().min(0, "The amount can't be negative.").max(100_000_000_000).nullish(),
  description: optText(200),
});

export async function saveViews(db: DB, firmId: number, raw: z.input<typeof viewsSchema>, userId: number) {
  await assertPartnersEnabled(db, firmId);
  const p = viewsSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const partner = await mustGetPartner(db, firmId, i.partnerId);
  const payout = await payoutFor(db, firmId, partner, i.month);
  const rate = i.ratePerMillionPaise ?? payout.ratePerMillionPaise;
  const amount = i.amountPaise ?? viewsAmountPaise(i.views, rate);
  await db
    .update(partnerPayouts)
    .set({ views: i.views, ratePerMillionPaise: rate, viewsAmountPaise: amount, viewsDescription: i.description, updatedAt: new Date() })
    .where(eq(partnerPayouts.id, payout.id));
  await audit(db, {
    firmId,
    userId,
    action: "update",
    entity: "partner",
    entityId: partner.id,
    summary: `${payeeName(partner)}, ${monthLabel(i.month)}: ${i.views.toLocaleString("en-US")} views, ${formatMoney(amount)}`,
  });
}

// ─── Promotions ──────────────────────────────────────────────────────────────

export const promotionSchema = z.object({
  partnerId: z.number().int().positive(),
  month: monthSchema,
  description: z.string().trim().min(1, "Describe the promotion.").max(200),
  amountPaise: z.number().int().positive("Enter the promotion amount.").max(100_000_000_000),
});

export async function addPromotion(db: DB, firmId: number, raw: z.input<typeof promotionSchema>, userId: number) {
  await assertPartnersEnabled(db, firmId);
  const p = promotionSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const partner = await mustGetPartner(db, firmId, i.partnerId);
  const payout = await payoutFor(db, firmId, partner, i.month);
  await db.insert(partnerPromotions).values({ payoutId: payout.id, description: i.description, amountPaise: i.amountPaise });
  await audit(db, { firmId, userId, action: "update", entity: "partner", entityId: partner.id, summary: `${payeeName(partner)}, ${monthLabel(i.month)}: promotion "${i.description}" ${formatMoney(i.amountPaise)}` });
}

export async function removePromotion(db: DB, firmId: number, promotionId: number, userId: number) {
  await assertPartnersEnabled(db, firmId);
  const [row] = await db
    .select({ id: partnerPromotions.id, description: partnerPromotions.description, amountPaise: partnerPromotions.amountPaise, partnerId: partnerPayouts.partnerId, month: partnerPayouts.month })
    .from(partnerPromotions)
    .innerJoin(partnerPayouts, eq(partnerPayouts.id, partnerPromotions.payoutId))
    .where(and(eq(partnerPromotions.id, promotionId), eq(partnerPayouts.firmId, firmId)));
  if (!row) throw new MasterError("This promotion no longer exists.");
  await db.delete(partnerPromotions).where(eq(partnerPromotions.id, promotionId));
  await audit(db, { firmId, userId, action: "update", entity: "partner", entityId: row.partnerId, summary: `${monthLabel(row.month)}: removed promotion "${row.description}" ${formatMoney(row.amountPaise)}` });
}

// ─── Paying ──────────────────────────────────────────────────────────────────

/** The company's "Partner payments" expense category, created the first time it's needed. */
export async function partnerCategoryId(db: DB | Tx, firmId: number): Promise<number> {
  const cats = await db.select().from(ledgerCategories).where(and(eq(ledgerCategories.firmId, firmId), eq(ledgerCategories.kind, "expense")));
  const hit = cats.find((c) => c.name.toLowerCase() === "partner payments");
  if (hit) return hit.id;
  const [row] = await db.insert(ledgerCategories).values({ firmId, kind: "expense", name: "Partner payments" }).returning({ id: ledgerCategories.id });
  return row.id;
}

export const payPartnerSchema = z.object({
  partnerId: z.number().int().positive(),
  month: monthSchema,
  amountPaise: z.number().int().positive("Enter the amount paid."),
  date: isoDate,
  accountId: z.number().int().positive("Choose where the money was paid from."),
  paymentMode: optText(30),
  note: optText(300),
});

/** Records a payment to a partner as a "Partner payments" expense tagged to the partner and month. */
export async function payPartner(db: DB, firmId: number, raw: z.input<typeof payPartnerSchema>, userId: number): Promise<SaveResult> {
  await assertPartnersEnabled(db, firmId);
  const p = payPartnerSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const partner = await mustGetPartner(db, firmId, i.partnerId);
  const row = (await partnerSheet(db, firmId, i.month)).rows.find((r) => r.partnerId === partner.id);
  const total = row?.totalPaise ?? 0;
  const due = row?.duePaise ?? 0;
  const who = payeeName(partner);
  if (total <= 0) throw new MasterError(`There is nothing to pay ${who} for ${monthLabel(i.month)} yet. Enter their views or add a promotion first.`, "amountPaise");
  if (i.amountPaise > due) {
    throw new MasterError(
      due <= 0
        ? `${who} has been paid in full for ${monthLabel(i.month)}.`
        : `That's more than the ${formatMoney(due)} still due to ${who} for ${monthLabel(i.month)}. Add a promotion first if you're paying extra.`,
      "amountPaise",
    );
  }
  try {
    return await saveVoucher(
      db,
      firmId,
      {
        type: "expense",
        date: i.date,
        partyName: who,
        categoryId: await partnerCategoryId(db, firmId),
        accountId: i.accountId,
        paymentMode: i.paymentMode,
        paidPaise: i.amountPaise,
        itcEligible: false,
        roundOff: false, // pay exactly what was entered, or the sheet and the books would disagree
        partnerId: partner.id,
        payMonth: i.month,
        notes: i.note,
        lines: [{ description: `Partner payment, ${monthLabel(i.month)} — ${who}`, qtyMilli: 1000, ratePaise: i.amountPaise }],
      },
      userId,
    );
  } catch (e) {
    if (e instanceof VoucherError) throw new MasterError(e.message);
    throw e;
  }
}

/** Everything ever paid to one partner, newest first (cancelled entries included, marked as such). */
export async function partnerPayments(db: DB, firmId: number, partnerId: number) {
  return db
    .select({ id: vouchers.id, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date, payMonth: vouchers.payMonth, totalPaise: vouchers.totalPaise, status: vouchers.status })
    .from(vouchers)
    .where(and(eq(vouchers.firmId, firmId), eq(vouchers.partnerId, partnerId), sql`${vouchers.status} <> 'deleted'`))
    .orderBy(sql`${vouchers.date} desc`, sql`${vouchers.id} desc`);
}

/** Every month a partner has views, promotions or an invoice for, newest first. */
export async function partnerHistory(db: DB, firmId: number, partnerId: number) {
  const payouts = await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.firmId, firmId), eq(partnerPayouts.partnerId, partnerId))).orderBy(sql`${partnerPayouts.month} desc`);
  const promos = payouts.length ? await db.select().from(partnerPromotions).where(inArray(partnerPromotions.payoutId, payouts.map((p) => p.id))) : [];
  return payouts.map((p) => {
    const promotionsPaise = promos.filter((x) => x.payoutId === p.id).reduce((s, x) => s + x.amountPaise, 0);
    return { payoutId: p.id, month: p.month, views: p.views, viewsAmountPaise: p.viewsAmountPaise, promotionsPaise, totalPaise: p.viewsAmountPaise + promotionsPaise, invoiceNo: p.invoiceNo };
  });
}

// ─── Payout invoices ─────────────────────────────────────────────────────────

export const payoutSettingsSchema = z.object({
  payoutPrefix: z.string().trim().min(1, "Enter the invoice number prefix.").max(12).regex(/^[A-Za-z0-9\-_]+$/, "Use letters and numbers only."),
  payoutLlpin: z.string().trim().max(30).default(""),
  payoutTan: z.string().trim().max(20).default(""),
  payoutSignerName: z.string().trim().max(120).default(""),
  payoutSignerRole: z.string().trim().max(80).default(""),
  payoutShowSignature: z.boolean().default(true),
  payoutRatePerMillionPaise: z.number().int().min(0).max(1_000_000_000),
  payoutViewsDescription: z.string().trim().min(1, "Enter the usual wording for the views line.").max(200),
  payoutNotes: z.string().trim().max(1000).default(""),
});

export async function savePayoutSettings(db: DB, firmId: number, raw: z.input<typeof payoutSettingsSchema>, userId: number) {
  await assertPartnersEnabled(db, firmId);
  const p = payoutSettingsSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  await saveSettings(db, firmId, p.data);
  await audit(db, { firmId, userId, action: "settings", entity: "partner", summary: "Changed payout invoice settings" });
}

/** The number a new invoice dated `date` would get. */
export async function suggestInvoiceNo(db: DB | Tx, firmId: number, date: string): Promise<string> {
  const cfg = await getSettings(db, firmId);
  const used = (await db.select({ no: partnerPayouts.invoiceNo }).from(partnerPayouts).where(and(eq(partnerPayouts.firmId, firmId), sql`${partnerPayouts.invoiceNo} is not null`))).map((r) => r.no!);
  return payoutInvoiceNo(cfg.payoutPrefix, date, nextInvoiceSequence(used, cfg.payoutPrefix, date));
}

export const invoiceSchema = z.object({
  partnerId: z.number().int().positive(),
  month: monthSchema,
  /** Left out: keep this month's number if it has one, otherwise the next in the series. */
  invoiceNo: optText(40),
  date: isoDate,
  period: optText(60),
  description: optText(200),
  notes: optText(1000),
});

/** Makes (or updates) the payout invoice for a partner's month and returns its payout id. */
export async function savePayoutInvoice(db: DB, firmId: number, raw: z.input<typeof invoiceSchema>, userId: number): Promise<{ payoutId: number; invoiceNo: string; created: boolean }> {
  await assertPartnersEnabled(db, firmId);
  const p = invoiceSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const partner = await mustGetPartner(db, firmId, i.partnerId);
  return db.transaction(async (tx) => {
    // One invoice number is handed out at a time, so two people can never get the same one.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payout-invoice:${firmId}`}))`);
    const payout = await payoutFor(tx, firmId, partner, i.month);
    const promos = await tx.select({ amountPaise: partnerPromotions.amountPaise }).from(partnerPromotions).where(eq(partnerPromotions.payoutId, payout.id));
    if (payout.viewsAmountPaise + promos.reduce((s, x) => s + x.amountPaise, 0) <= 0) {
      throw new MasterError(`There is nothing to invoice for ${payeeName(partner)} in ${monthLabel(i.month)} yet. Enter their views or add a promotion first.`);
    }
    const created = !payout.invoiceNo;
    const invoiceNo = i.invoiceNo ?? payout.invoiceNo ?? (await suggestInvoiceNo(tx, firmId, i.date));
    const [clash] = await tx
      .select({ id: partnerPayouts.id, month: partnerPayouts.month, partnerId: partnerPayouts.partnerId })
      .from(partnerPayouts)
      .where(and(eq(partnerPayouts.firmId, firmId), sql`lower(${partnerPayouts.invoiceNo}) = lower(${invoiceNo})`, sql`${partnerPayouts.id} <> ${payout.id}`));
    if (clash) throw new MasterError(`Invoice number ${invoiceNo} is already used for another invoice. Choose a different number.`, "invoiceNo");
    const cfg = await getSettings(tx, firmId);
    const payee: Record<string, string> = {
      name: payeeName(partner),
      handle: partner.handle ?? "",
      contact: partner.channelName ? partner.name : "",
      email: partner.email ?? "",
      address: partner.address ?? "",
      pan: partner.pan ?? "",
      paymentTo: paymentToLine(partner),
    };
    await tx
      .update(partnerPayouts)
      .set({
        invoiceNo,
        invoiceDate: i.date,
        period: i.period ?? monthLabel(i.month),
        invoiceNotes: i.notes ?? cfg.payoutNotes,
        viewsDescription: i.description ?? payout.viewsDescription ?? cfg.payoutViewsDescription,
        payee,
        updatedAt: new Date(),
      })
      .where(eq(partnerPayouts.id, payout.id));
    await audit(tx, { firmId, userId, action: created ? "create" : "update", entity: "partner", entityId: partner.id, summary: `${created ? "Made" : "Updated"} payout invoice ${invoiceNo} for ${payeeName(partner)}, ${monthLabel(i.month)}` });
    return { payoutId: payout.id, invoiceNo, created };
  });
}

/** Everything the printed payout invoice shows. */
export interface PayoutInvoiceModel {
  invoiceNo: string;
  date: string;
  period: string;
  company: { name: string; addressLines: string[]; contactLine: string; idLine: string; website: string };
  payee: { name: string; lines: string[] };
  items: { description: string; sub: string | null; basis: string; amountPaise: number }[];
  totalPaise: number;
  words: string;
  notes: string;
  signer: { name: string; role: string; companyName: string };
  logo: string | null;
  signature: string | null;
}

export async function loadPayoutInvoice(db: DB, firmId: number, payoutId: number): Promise<{ model: PayoutInvoiceModel; payoutId: number; partnerId: number; phone: string | null; month: string } | null> {
  const [payout] = await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.id, payoutId), eq(partnerPayouts.firmId, firmId)));
  if (!payout || !payout.invoiceNo || !payout.invoiceDate) return null;
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  const partner = await getPartner(db, firmId, payout.partnerId);
  if (!firm || !partner) return null;
  const cfg = await getSettings(db, firmId);
  const promos = await db.select().from(partnerPromotions).where(eq(partnerPromotions.payoutId, payout.id)).orderBy(asc(partnerPromotions.id));
  const images = await imageDataUrls(db, firmId);

  const items: PayoutInvoiceModel["items"] = [];
  if (payout.views > 0 || payout.viewsAmountPaise > 0) {
    const short = compactViews(payout.views);
    items.push({
      description: payout.viewsDescription || cfg.payoutViewsDescription,
      sub: `@ ${formatMoney(payout.ratePerMillionPaise)} per 10,00,000 views`,
      basis: `${groupViews(payout.views)} views${short ? ` (${short})` : ""}`,
      amountPaise: payout.viewsAmountPaise,
    });
  }
  for (const x of promos) items.push({ description: x.description, sub: null, basis: "Agreed fee", amountPaise: x.amountPaise });
  const totalPaise = items.reduce((s, x) => s + x.amountPaise, 0);

  const pe = payout.payee ?? {};
  const payeeLines: string[] = [];
  const l1 = [pe.handle, pe.contact].filter(Boolean).join(" · ");
  if (l1) payeeLines.push(l1);
  const l2 = [pe.email, pe.address].filter(Boolean).join(" · ");
  if (l2) payeeLines.push(l2);
  if (pe.pan) payeeLines.push(`PAN ${pe.pan}`);
  if (pe.paymentTo) payeeLines.push(`Payment to: ${pe.paymentTo}`);

  const addressLines = [firm.address, [firm.city, firm.pincode].filter(Boolean).join(" ")].filter(Boolean) as string[];
  const ids = [cfg.payoutLlpin && `LLPIN ${cfg.payoutLlpin}`, firm.pan && `PAN ${firm.pan}`, cfg.payoutTan && `TAN ${cfg.payoutTan}`, firm.gstin && `GSTIN ${firm.gstin}`].filter(Boolean) as string[];
  const companyName = firm.legalName || firm.name;
  return {
    payoutId: payout.id,
    partnerId: partner.id,
    phone: partner.phone,
    month: payout.month,
    model: {
      invoiceNo: payout.invoiceNo,
      date: payout.invoiceDate,
      period: payout.period ?? monthLabel(payout.month),
      company: {
        name: companyName,
        addressLines,
        contactLine: [firm.website, firm.email, firm.phone].filter(Boolean).join(" · "),
        idLine: ids.join(" · "),
        website: firm.website ?? "",
      },
      payee: { name: pe.name || payeeName(partner), lines: payeeLines },
      items,
      totalPaise,
      words: rupeesInWords(totalPaise),
      notes: payout.invoiceNotes ?? "",
      signer: { name: cfg.payoutSignerName, role: cfg.payoutSignerRole || "Designated Partner", companyName },
      logo: images.logo,
      signature: cfg.payoutShowSignature ? images.signature : null,
    },
  };
}

// ─── Private links (WhatsApp) ────────────────────────────────────────────────

/** An unguessable address that opens one invoice's PDF without signing in, valid for 90 days. */
export async function createPayoutLink(db: DB, firmId: number, payoutId: number, userId: number): Promise<string> {
  await assertPartnersEnabled(db, firmId);
  const [payout] = await db.select({ id: partnerPayouts.id, invoiceNo: partnerPayouts.invoiceNo, partnerId: partnerPayouts.partnerId }).from(partnerPayouts).where(and(eq(partnerPayouts.id, payoutId), eq(partnerPayouts.firmId, firmId)));
  if (!payout?.invoiceNo) throw new MasterError("Make the invoice first.");
  const [have] = await db
    .select({ token: partnerPayoutLinks.token })
    .from(partnerPayoutLinks)
    .where(and(eq(partnerPayoutLinks.payoutId, payoutId), gt(partnerPayoutLinks.expiresAt, new Date(Date.now() + 7 * 86400_000))));
  let token = have?.token;
  if (!token) {
    token = randomBytes(18).toString("base64url");
    await db.insert(partnerPayoutLinks).values({ token, payoutId, expiresAt: new Date(Date.now() + 90 * 86400_000) });
    await audit(db, { firmId, userId, action: "export", entity: "partner", entityId: payout.partnerId, summary: `Made a private link for payout invoice ${payout.invoiceNo}` });
  }
  return token;
}

/** The invoice a private link points to, or null when the link is unknown or has expired. */
export async function resolvePayoutLink(db: DB, token: string): Promise<{ payoutId: number; firmId: number } | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const [row] = await db
    .select({ payoutId: partnerPayoutLinks.payoutId, firmId: partnerPayouts.firmId })
    .from(partnerPayoutLinks)
    .innerJoin(partnerPayouts, eq(partnerPayouts.id, partnerPayoutLinks.payoutId))
    .where(and(eq(partnerPayoutLinks.token, token), gt(partnerPayoutLinks.expiresAt, new Date())));
  return row ?? null;
}

/** The ready-to-send WhatsApp message for an invoice. */
export function payoutMessage(m: { companyName: string; invoiceNo: string; period: string; totalPaise: number }, url: string) {
  return `${m.companyName}: payout invoice ${m.invoiceNo} for ${m.period}, ${formatMoney(m.totalPaise)}.\n\n${url}`;
}

// ─── Excel ───────────────────────────────────────────────────────────────────

export const sheetColumns = [
  { header: "Invoice No", key: "invoiceNo", width: 18 },
  { header: "Partner ID", key: "code", width: 11 },
  { header: "Creator / Channel", key: "channel", width: 26 },
  { header: "Type", key: "kind", width: 14 },
  { header: "Contact", key: "contact", width: 20 },
  { header: "Phone", key: "phone", width: 16 },
  { header: "Email", key: "email", width: 26 },
  { header: "PAN", key: "pan", width: 14 },
  { header: "Payment To", key: "paymentTo", width: 44 },
  { header: "Total Views", key: "views", width: 14, kind: "number" as const },
  { header: "Rate per 10,00,000 (INR)", key: "rate", width: 22, kind: "money" as const },
  { header: "Views Amount (INR)", key: "viewsAmount", width: 18, kind: "money" as const },
  { header: "Promotion Detail", key: "promoDetail", width: 36 },
  { header: "Promotion Amount (INR)", key: "promoAmount", width: 21, kind: "money" as const },
  { header: "Total Payable (INR)", key: "total", width: 19, kind: "money" as const },
  { header: "Paid (INR)", key: "paid", width: 14, kind: "money" as const },
  { header: "Due (INR)", key: "due", width: 14, kind: "money" as const },
];

/** The month as rows for Excel, with each partner's bank details to make the transfers from. */
export async function exportPartnerSheet(db: DB, firmId: number, month: string) {
  const sheet = await partnerSheet(db, firmId, month);
  const all = new Map((await listPartners(db, firmId, { includeInactive: true })).map((p) => [p.id, p]));
  return sheet.rows
    .filter((r) => r.totalPaise > 0 || r.paidPaise > 0)
    .map((r) => {
      const p = all.get(r.partnerId)!;
      return {
        invoiceNo: r.invoiceNo ?? "",
        code: r.code,
        channel: r.channelName || r.name,
        kind: r.kind === "international" ? "International" : "National",
        contact: r.name,
        phone: p.phone ?? "",
        email: p.email ?? "",
        pan: p.pan ?? "",
        paymentTo: paymentToLine(p),
        views: r.views,
        rate: r.rateUsedPaise / 100,
        viewsAmount: r.viewsAmountPaise / 100,
        promoDetail: r.promotions.map((x) => `${x.description} — ₹${x.amountPaise / 100}`).join(" | "),
        promoAmount: r.promotionsPaise / 100,
        total: r.totalPaise / 100,
        paid: r.paidPaise / 100,
        due: r.duePaise / 100,
      };
    });
}

// ─── Growth ──────────────────────────────────────────────────────────────────

export interface PartnerGrowth {
  /** Everyone ever onboarded, and how that splits. */
  total: number;
  active: number;
  national: number;
  international: number;
  addedThisMonth: number;
  addedLastMonth: number;
  /** Oldest first; `total` is everyone onboarded up to the end of that month. */
  months: { month: string; national: number; international: number; added: number; total: number }[];
}

/**
 * How the partner list has grown: totals, and how many were added in each of the last `span` months.
 * A partner counts from the day they joined, or the day they were added to the app when no joining date was given.
 */
export async function partnerGrowth(db: DB, firmId: number, today: string, span = 12): Promise<PartnerGrowth> {
  const all = await listPartners(db, firmId, { includeInactive: true });
  const thisMonth = today.slice(0, 7);
  const since = (p: (typeof all)[number]) => (p.joinedOn ?? localDate(p.createdAt)).slice(0, 7);
  const list: string[] = [];
  for (let i = span - 1; i >= 0; i--) list.push(shiftMonth(thisMonth, -i));
  const months = list.map((month) => {
    const added = all.filter((p) => since(p) === month);
    const international = added.filter((p) => p.kind === "international").length;
    return { month, national: added.length - international, international, added: added.length, total: all.filter((p) => since(p) <= month).length };
  });
  const international = all.filter((p) => p.kind === "international").length;
  return {
    total: all.length,
    active: all.filter((p) => p.active).length,
    national: all.length - international,
    international,
    addedThisMonth: months[months.length - 1].added,
    addedLastMonth: months.length > 1 ? months[months.length - 2].added : 0,
    months,
  };
}
