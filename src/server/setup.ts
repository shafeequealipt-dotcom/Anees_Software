import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { accounts, firms, ledgerCategories, roles, taxRates, units, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/auth";
import { checkGstin } from "@/lib/gst/gstin";
import { checkTrn } from "@/lib/gst/trn";
import { REGIONS, setRegion, type Country } from "@/lib/region";
import { isValidStateCode } from "@/lib/gst/states";
import { MasterError } from "./masters";

export async function needsSetup(db: DB): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row.n === 0;
}

export const setupSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your business name.").max(200),
  country: z.enum(["IN", "SA"]).default("IN"),
  /** Tax registration number: GSTIN in India, VAT number (TRN) in Saudi Arabia. Optional. */
  gstin: z.string().trim().max(15).optional().transform((v) => (v ? v.toUpperCase() : null)),
  gstScheme: z.enum(["regular", "composition", "unregistered"]).default("regular"),
  /** India only, optional. */
  stateCode: z.string().optional().transform((v) => v || null),
  address: z.string().trim().max(1000).optional(),
  phone: z.string().trim().max(30).optional(),
  ownerName: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().max(200),
});

/** Checks a company's tax number and state for its country; returns the cleaned values. */
export function checkCompanyTax(country: Country, taxId: string | null | undefined, stateCode: string | null | undefined) {
  let state: string | null = stateCode || null;
  const id = taxId ? taxId.trim().toUpperCase() : null;
  if (country === "SA") {
    state = null;
    if (id) {
      const t = checkTrn(id);
      if (!t.ok) throw new MasterError(t.reason, "gstin");
    }
  } else {
    if (state && !isValidStateCode(state)) throw new MasterError("Choose a valid state.", "stateCode");
    if (id) {
      const g = checkGstin(id);
      if (!g.ok) throw new MasterError(g.reason, "gstin");
      if (state && g.stateCode !== state) throw new MasterError("The GSTIN's state doesn't match the state you chose.", "stateCode");
      state = state || g.stateCode;
    }
  }
  return { taxId: id, stateCode: state };
}

export const companySchema = z.object({
  name: z.string().trim().min(1, "Enter the company name.").max(200),
  country: z.enum(["IN", "SA"]).default("IN"),
  taxId: z.string().trim().max(15).optional().transform((v) => (v ? v.toUpperCase() : null)),
  gstScheme: z.enum(["regular", "composition", "unregistered"]).default("regular"),
  stateCode: z.string().optional().transform((v) => v || null),
  address: z.string().trim().max(1000).optional().transform((v) => v || null),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  email: z.string().trim().max(200).optional().transform((v) => v || null),
});

/** Adds a company with its tax rates, units, categories and a cash account. Returns the new company's id. */
export async function insertCompany(tx: DB, raw: z.input<typeof companySchema>): Promise<number> {
  const p = companySchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const c = p.data;
  const tax = checkCompanyTax(c.country, c.taxId, c.stateCode);
  const [firm] = await tx
    .insert(firms)
    .values({
      name: c.name,
      gstin: tax.taxId,
      country: c.country,
      pan: c.country === "IN" && tax.taxId ? tax.taxId.slice(2, 12) : null,
      gstScheme: tax.taxId ? c.gstScheme : "unregistered",
      stateCode: tax.stateCode,
      address: c.address,
      phone: c.phone,
      email: c.email,
    })
    .returning({ id: firms.id });
  await seedDefaults(tx, firm.id, c.country);
  return firm.id;
}

export async function runFirstSetup(db: DB, raw: z.input<typeof setupSchema>) {
  const p = setupSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const input = p.data;
  const weak = passwordProblem(input.password);
  if (weak) throw new MasterError(weak, "password");
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (count.n > 0) throw new MasterError("Setup has already been completed. Sign in instead.");

    const firmId = await insertCompany(tx as unknown as DB, {
      name: input.businessName,
      country: input.country,
      taxId: input.gstin ?? undefined,
      gstScheme: input.gstScheme,
      stateCode: input.stateCode ?? undefined,
      address: input.address,
      phone: input.phone,
      email: input.email,
    });
    const [ownerRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.isOwner, true));
    const [owner] = await tx
      .insert(users)
      .values({ name: input.ownerName, email: input.email, passwordHash, roleId: ownerRole.id })
      .returning({ id: users.id });

    setRegion(input.country);
    await audit(tx, { firmId, userId: owner.id, action: "create", entity: "setup", summary: `Business "${input.businessName}" set up by ${input.ownerName}` });
    return owner.id;
  });
}

/** Tax rates, units, categories and a cash account every company needs. Safe to run once per company. */
export async function seedDefaults(db: DB, firmId: number, country: Country = "IN") {
  const [hasRates] = await db.select({ n: sql<number>`count(*)::int` }).from(taxRates).where(eq(taxRates.firmId, firmId));
  if (hasRates.n === 0) {
    await db.insert(taxRates).values(
      REGIONS[country].defaultTaxRates.map((r) => ({ firmId, name: r.name, gstBp: r.gstBp, nature: r.nature, sort: r.sort, active: r.active ?? true })),
    );
  }
  const [hasUnits] = await db.select({ n: sql<number>`count(*)::int` }).from(units).where(eq(units.firmId, firmId));
  if (hasUnits.n === 0) {
    await db.insert(units).values(
      [
        ["Numbers", "NOS"], ["Pieces", "PCS"], ["Kilograms", "KGS"], ["Grams", "GMS"], ["Litres", "LTR"], ["Millilitres", "MLT"],
        ["Metres", "MTR"], ["Boxes", "BOX"], ["Packs", "PAC"], ["Dozens", "DOZ"], ["Sets", "SET"], ["Bags", "BAG"],
        ["Bottles", "BTL"], ["Cartons", "CTN"], ["Quintals", "QTL"], ["Tonnes", "TON"], ["Square feet", "SQF"],
        ["Square metres", "SQM"], ["Units", "UNT"], ["Others", "OTH"],
      ].map(([name, code]) => ({ firmId, name, code })),
    );
  }
  const [hasCats] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerCategories).where(eq(ledgerCategories.firmId, firmId));
  if (hasCats.n === 0) {
    const expense = ["Rent", "Salaries & wages", "Electricity", "Transport & freight", "Office supplies", "Phone & internet", "Repairs & maintenance", "Travel", "Bank charges", "Miscellaneous"];
    const income = ["Interest received", "Commission received", "Discount received", "Other income"];
    await db.insert(ledgerCategories).values([
      ...expense.map((name) => ({ firmId, kind: "expense" as const, name })),
      ...income.map((name) => ({ firmId, kind: "income" as const, name })),
    ]);
  }
  const [hasAccounts] = await db.select({ n: sql<number>`count(*)::int` }).from(accounts).where(eq(accounts.firmId, firmId));
  if (hasAccounts.n === 0) {
    await db.insert(accounts).values({ firmId, kind: "cash", name: "Cash in hand", isDefault: true });
  }
}
