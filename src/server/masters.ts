import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import {
  accounts,
  itemCategories,
  items,
  ledgerCategories,
  moneyLedger,
  parties,
  partyGroups,
  partyLedger,
  stockLedger,
  taxRates,
  units,
  voucherLines,
  vouchers,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { financialYear, isIsoDate, todayIST } from "@/lib/dates";
import { checkGstin } from "@/lib/gst/gstin";
import { checkTrn } from "@/lib/gst/trn";
import { region } from "@/lib/region";
import { isValidStateCode } from "@/lib/gst/states";

/** Opening balances default to the first day of the current financial year. */
const defaultOpeningDate = () => financialYear(todayIST()).from;

export class MasterError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

const text = (max: number) =>
  z.string().max(max, `Keep this under ${max} characters.`).nullish().transform((v) => (v && v.trim() ? v.trim() : null));
const optDate = z
  .string()
  .nullish()
  .refine((v) => !v || isIsoDate(v), "Enter a valid date.")
  .transform((v) => v || null);

function firstIssue(e: z.ZodError) {
  const i = e.issues[0];
  return new MasterError(i.message, i.path.join("."));
}

// ─── Parties ─────────────────────────────────────────────────────────────────

export const partySchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(["customer", "supplier", "both"]).default("customer"),
  name: z.string().trim().min(1, "Enter the party name.").max(200),
  gstin: text(15),
  pan: text(10),
  phone: text(30),
  email: z.union([z.string().trim().email("Enter a valid email."), z.literal(""), z.null()]).optional().transform((v) => v || null),
  billingAddress: text(1000),
  shippingAddress: text(1000),
  stateCode: text(2),
  groupId: z.number().int().positive().nullish(),
  openingBalancePaise: z.number().int().default(0),
  openingDate: optDate,
  creditDays: z.number().int().min(0).max(3650).nullish(),
  creditLimitPaise: z.number().int().min(0).nullish(),
  notes: text(2000),
  active: z.boolean().default(true),
});

export async function saveParty(db: DB, firmId: number, raw: z.input<typeof partySchema>, userId: number | null) {
  const p = partySchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const input = p.data;
  if (region().country === "SA") {
    input.stateCode = null;
    if (input.gstin) {
      const t = checkTrn(input.gstin);
      if (!t.ok) throw new MasterError(t.reason, "gstin");
    }
  } else {
    if (input.gstin) {
      input.gstin = input.gstin.toUpperCase();
      const check = checkGstin(input.gstin);
      if (!check.ok) throw new MasterError(check.reason, "gstin");
      input.stateCode = input.stateCode || check.stateCode;
      input.pan = input.pan || check.pan;
    }
    if (input.stateCode && !isValidStateCode(input.stateCode)) throw new MasterError("Choose a valid state.", "stateCode");
  }

  return db.transaction(async (tx) => {
    const dupe = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.firmId, firmId), sql`lower(${parties.name}) = ${input.name.toLowerCase()}`, input.id ? sql`${parties.id} <> ${input.id}` : sql`true`));
    if (dupe.length) throw new MasterError(`A party named "${input.name}" already exists.`, "name");

    if (input.groupId) {
      const [g] = await tx.select({ id: partyGroups.id }).from(partyGroups).where(and(eq(partyGroups.id, input.groupId), eq(partyGroups.firmId, firmId)));
      if (!g) throw new MasterError("Choose a group from this company.", "groupId");
    }
    const values = { ...input, firmId, openingDate: input.openingDate ?? defaultOpeningDate(), updatedAt: new Date() };
    delete (values as { id?: number }).id;
    let id = input.id;
    let before;
    if (id) {
      [before] = await tx.select().from(parties).where(and(eq(parties.id, id), eq(parties.firmId, firmId)));
      if (!before) throw new MasterError("This party no longer exists.");
      await tx.update(parties).set(values).where(eq(parties.id, id));
    } else {
      [{ id }] = await tx.insert(parties).values(values).returning({ id: parties.id });
    }
    await tx.delete(partyLedger).where(and(eq(partyLedger.partyId, id!), eq(partyLedger.source, "opening")));
    if (values.openingBalancePaise !== 0) {
      await tx.insert(partyLedger).values({
        source: "opening",
        partyId: id!,
        date: values.openingDate,
        amountPaise: values.openingBalancePaise,
        memo: "Opening balance",
      });
    }
    await audit(tx, {
      firmId,
      userId,
      action: before ? "update" : "create",
      entity: "party",
      entityId: id!,
      summary: `${before ? "Edited" : "Added"} party ${values.name}`,
      before,
      after: values,
    });
    return id!;
  });
}

export async function deleteParty(db: DB, firmId: number, id: number, userId: number | null) {
  return db.transaction(async (tx) => {
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(vouchers).where(eq(vouchers.partyId, id));
    const [p] = await tx.select().from(parties).where(and(eq(parties.id, id), eq(parties.firmId, firmId)));
    if (!p) return;
    if (used.n > 0) {
      await tx.update(parties).set({ active: false, updatedAt: new Date() }).where(eq(parties.id, id));
      await audit(tx, { firmId, userId, action: "update", entity: "party", entityId: id, summary: `Deactivated party ${p.name} (has ${used.n} entries)` });
      return "deactivated" as const;
    }
    await tx.delete(parties).where(eq(parties.id, id));
    await audit(tx, { firmId, userId, action: "delete", entity: "party", entityId: id, summary: `Deleted party ${p.name}`, before: p });
    return "deleted" as const;
  });
}

export async function savePartyGroup(db: DB | Tx, firmId: number, name: string) {
  const clean = name.trim();
  if (!clean) throw new MasterError("Enter a group name.");
  const [row] = await db
    .insert(partyGroups)
    .values({ firmId, name: clean })
    .onConflictDoUpdate({ target: [partyGroups.firmId, partyGroups.name], set: { name: clean } })
    .returning({ id: partyGroups.id });
  return row.id;
}

// ─── Items ───────────────────────────────────────────────────────────────────

export const itemSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(["goods", "service"]).default("goods"),
  name: z.string().trim().min(1, "Enter the item name.").max(200),
  code: text(60),
  hsn: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine((v) => !v || /^\d{4,8}$/.test(v), "HSN/SAC code is 4 to 8 digits."),
  description: text(2000),
  categoryId: z.number().int().positive().nullish(),
  unitId: z.number().int().positive().nullish(),
  altUnitId: z.number().int().positive().nullish(),
  altUnitFactorMilli: z.number().int().positive().nullish(),
  salePricePaise: z.number().int().min(0).default(0),
  salePriceIncludesTax: z.boolean().default(false),
  purchasePricePaise: z.number().int().min(0).default(0),
  purchasePriceIncludesTax: z.boolean().default(false),
  mrpPaise: z.number().int().min(0).nullish(),
  taxRateId: z.number().int().positive().nullish(),
  openingQtyMilli: z.number().int().default(0),
  openingRatePaise: z.number().int().min(0).default(0),
  openingDate: optDate,
  minStockMilli: z.number().int().min(0).default(0),
  location: text(100),
  trackBatches: z.boolean().default(false),
  trackSerials: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function saveItem(db: DB, firmId: number, raw: z.input<typeof itemSchema>, userId: number | null) {
  const p = itemSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const input = p.data;
  if (input.altUnitId && !input.altUnitFactorMilli) throw new MasterError("Enter how many base units make one alternate unit.", "altUnitFactorMilli");
  if (input.kind === "service") {
    input.openingQtyMilli = 0;
    input.minStockMilli = 0;
  }

  return db.transaction(async (tx) => {
    const dupe = await tx
      .select({ id: items.id, name: items.name, code: items.code })
      .from(items)
      .where(
        and(
          eq(items.firmId, firmId),
          input.code ? sql`(lower(${items.name}) = ${input.name.toLowerCase()} or ${items.code} = ${input.code})` : sql`lower(${items.name}) = ${input.name.toLowerCase()}`,
          input.id ? sql`${items.id} <> ${input.id}` : sql`true`,
        ),
      );
    if (dupe.length) {
      const d = dupe[0];
      throw d.code && d.code === input.code
        ? new MasterError(`Item code "${input.code}" is already used by "${d.name}".`, "code")
        : new MasterError(`An item named "${input.name}" already exists.`, "name");
    }

    const refs: [string, number | null | undefined, PgTable & { id: PgColumn; firmId: PgColumn }][] = [
      ["category", input.categoryId, itemCategories],
      ["unit", input.unitId, units],
      ["alternate unit", input.altUnitId, units],
      ["tax rate", input.taxRateId, taxRates],
    ];
    for (const [label, refId, table] of refs) {
      if (!refId) continue;
      const [ok] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, refId), eq(table.firmId, firmId)));
      if (!ok) throw new MasterError(`Choose a ${label} from this company.`);
    }
    const values = { ...input, firmId, openingDate: input.openingDate ?? defaultOpeningDate(), updatedAt: new Date() };
    delete (values as { id?: number }).id;
    let id = input.id;
    let before;
    if (id) {
      [before] = await tx.select().from(items).where(and(eq(items.id, id), eq(items.firmId, firmId)));
      if (!before) throw new MasterError("This item no longer exists.");
      if (before.kind !== values.kind) {
        const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(voucherLines).where(eq(voucherLines.itemId, id));
        if (used.n > 0) throw new MasterError("This item is already on bills, so it can't switch between goods and service.", "kind");
      }
      await tx.update(items).set(values).where(eq(items.id, id));
    } else {
      [{ id }] = await tx.insert(items).values(values).returning({ id: items.id });
    }
    await tx.delete(stockLedger).where(and(eq(stockLedger.itemId, id!), eq(stockLedger.source, "opening")));
    if (values.kind === "goods" && values.openingQtyMilli !== 0) {
      await tx.insert(stockLedger).values({
        source: "opening",
        itemId: id!,
        date: values.openingDate,
        qtyMilli: values.openingQtyMilli,
        valuePaise: Math.round((values.openingQtyMilli * values.openingRatePaise) / 1000),
      });
    }
    await audit(tx, {
      firmId,
      userId,
      action: before ? "update" : "create",
      entity: "item",
      entityId: id!,
      summary: `${before ? "Edited" : "Added"} item ${values.name}`,
      before,
      after: values,
    });
    return id!;
  });
}

export async function deleteItem(db: DB, firmId: number, id: number, userId: number | null) {
  return db.transaction(async (tx) => {
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(voucherLines).where(eq(voucherLines.itemId, id));
    const [it] = await tx.select().from(items).where(and(eq(items.id, id), eq(items.firmId, firmId)));
    if (!it) return;
    if (used.n > 0) {
      await tx.update(items).set({ active: false, updatedAt: new Date() }).where(eq(items.id, id));
      await audit(tx, { userId, action: "update", entity: "item", entityId: id, summary: `Deactivated item ${it.name} (on ${used.n} bill lines)` });
      return "deactivated" as const;
    }
    await tx.delete(items).where(eq(items.id, id));
    await audit(tx, { firmId, userId, action: "delete", entity: "item", entityId: id, summary: `Deleted item ${it.name}`, before: it });
    return "deleted" as const;
  });
}

export async function saveCategory(db: DB | Tx, firmId: number, name: string) {
  const clean = name.trim();
  if (!clean) throw new MasterError("Enter a category name.");
  const [row] = await db
    .insert(itemCategories)
    .values({ firmId, name: clean })
    .onConflictDoUpdate({ target: [itemCategories.firmId, itemCategories.name], set: { name: clean } })
    .returning({ id: itemCategories.id });
  return row.id;
}

export const unitSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Enter the unit name.").max(60),
  code: z.string().trim().min(1, "Enter a short code, e.g. PCS.").max(10).transform((v) => v.toUpperCase()),
  active: z.boolean().default(true),
});

export async function saveUnit(db: DB | Tx, firmId: number, raw: z.input<typeof unitSchema>) {
  const p = unitSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const { id, ...values } = p.data;
  if (id) {
    await db.update(units).set(values).where(and(eq(units.id, id), eq(units.firmId, firmId)));
    return id;
  }
  const [row] = await db.insert(units).values({ ...values, firmId }).returning({ id: units.id });
  return row.id;
}

export const taxRateSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(60),
  gstBp: z.number().int().min(0).max(10000),
  cessBp: z.number().int().min(0).max(10000).default(0),
  nature: z.enum(["taxable", "exempt", "nil", "non_gst"]).default("taxable"),
  sort: z.number().int().default(0),
  active: z.boolean().default(true),
});

export async function saveTaxRate(db: DB | Tx, firmId: number, raw: z.input<typeof taxRateSchema>) {
  const p = taxRateSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const { id, ...values } = p.data;
  if (id) {
    await db.update(taxRates).set(values).where(and(eq(taxRates.id, id), eq(taxRates.firmId, firmId)));
    return id;
  }
  const [row] = await db.insert(taxRates).values({ ...values, firmId }).returning({ id: taxRates.id });
  return row.id;
}

// ─── Cash & bank accounts ────────────────────────────────────────────────────

export const accountSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(["cash", "bank"]),
  name: z.string().trim().min(1, "Enter the account name.").max(120),
  bankName: text(120),
  accountNo: text(40),
  ifsc: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim().toUpperCase() : null))
    .refine((v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "IFSC looks like SBIN0001234."),
  upiId: text(100),
  openingBalancePaise: z.number().int().default(0),
  openingDate: optDate,
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function saveAccount(db: DB, firmId: number, raw: z.input<typeof accountSchema>, userId: number | null) {
  const p = accountSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const input = p.data;
  return db.transaction(async (tx) => {
    const values = { ...input, firmId, openingDate: input.openingDate ?? defaultOpeningDate() };
    delete (values as { id?: number }).id;
    let id = input.id;
    if (id) {
      const [own] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.firmId, firmId)));
      if (!own) throw new MasterError("This account no longer exists.");
    }
    if (values.isDefault) await tx.update(accounts).set({ isDefault: false }).where(and(eq(accounts.firmId, firmId), eq(accounts.kind, values.kind)));
    if (id) await tx.update(accounts).set(values).where(eq(accounts.id, id));
    else [{ id }] = await tx.insert(accounts).values(values).returning({ id: accounts.id });
    await tx.delete(moneyLedger).where(and(eq(moneyLedger.accountId, id!), eq(moneyLedger.source, "opening")));
    if (values.openingBalancePaise !== 0) {
      await tx.insert(moneyLedger).values({
        source: "opening",
        accountId: id!,
        date: values.openingDate,
        amountPaise: values.openingBalancePaise,
        memo: "Opening balance",
      });
    }
    await audit(tx, { firmId, userId, action: input.id ? "update" : "create", entity: "account", entityId: id!, summary: `${input.id ? "Edited" : "Added"} ${values.kind} account ${values.name}`, after: values });
    return id!;
  });
}

export async function saveLedgerCategory(db: DB | Tx, firmId: number, kind: "expense" | "income", name: string) {
  const clean = name.trim();
  if (!clean) throw new MasterError("Enter a category name.");
  const [found] = await db
    .select({ id: ledgerCategories.id })
    .from(ledgerCategories)
    .where(and(eq(ledgerCategories.firmId, firmId), eq(ledgerCategories.kind, kind), sql`lower(${ledgerCategories.name}) = ${clean.toLowerCase()}`));
  if (found) return found.id;
  const [row] = await db.insert(ledgerCategories).values({ firmId, kind, name: clean }).returning({ id: ledgerCategories.id });
  return row.id;
}
