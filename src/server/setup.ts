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

export async function runFirstSetup(db: DB, raw: z.input<typeof setupSchema>) {
  const p = setupSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const input = p.data;
  const weak = passwordProblem(input.password);
  if (weak) throw new MasterError(weak, "password");
  if (input.country === "SA") {
    input.stateCode = null;
    if (input.gstin) {
      const t = checkTrn(input.gstin);
      if (!t.ok) throw new MasterError(t.reason, "gstin");
    }
  } else {
    if (input.stateCode && !isValidStateCode(input.stateCode)) throw new MasterError("Choose a valid state.", "stateCode");
    if (input.gstin) {
      const g = checkGstin(input.gstin);
      if (!g.ok) throw new MasterError(g.reason, "gstin");
      if (input.stateCode && g.stateCode !== input.stateCode) throw new MasterError("The GSTIN's state doesn't match the state you chose.", "stateCode");
      input.stateCode = input.stateCode || g.stateCode;
    }
  }
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (count.n > 0) throw new MasterError("Setup has already been completed. Sign in instead.");

    await tx.insert(firms).values({
      name: input.businessName,
      gstin: input.gstin,
      country: input.country,
      pan: input.country === "IN" && input.gstin ? input.gstin.slice(2, 12) : null,
      gstScheme: input.gstin ? input.gstScheme : "unregistered",
      stateCode: input.stateCode,
      address: input.address || null,
      phone: input.phone || null,
      email: input.email,
      isDefault: true,
    });
    const [ownerRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.isOwner, true));
    const [owner] = await tx
      .insert(users)
      .values({ name: input.ownerName, email: input.email, passwordHash, roleId: ownerRole.id })
      .returning({ id: users.id });

    await seedDefaults(tx as unknown as DB, input.country);
    setRegion(input.country);
    await audit(tx, { userId: owner.id, action: "create", entity: "setup", summary: `Business "${input.businessName}" set up by ${input.ownerName}` });
    return owner.id;
  });
}

/** Tax rates, units, categories and a cash account every business needs. Safe to run once. */
export async function seedDefaults(db: DB, country: Country = "IN") {
  const [hasRates] = await db.select({ n: sql<number>`count(*)::int` }).from(taxRates);
  if (hasRates.n === 0) {
    await db.insert(taxRates).values(
      REGIONS[country].defaultTaxRates.map((r) => ({ name: r.name, gstBp: r.gstBp, nature: r.nature, sort: r.sort, active: r.active ?? true })),
    );
  }
  const [hasUnits] = await db.select({ n: sql<number>`count(*)::int` }).from(units);
  if (hasUnits.n === 0) {
    await db.insert(units).values([
      { name: "Numbers", code: "NOS" },
      { name: "Pieces", code: "PCS" },
      { name: "Kilograms", code: "KGS" },
      { name: "Grams", code: "GMS" },
      { name: "Litres", code: "LTR" },
      { name: "Millilitres", code: "MLT" },
      { name: "Metres", code: "MTR" },
      { name: "Boxes", code: "BOX" },
      { name: "Packs", code: "PAC" },
      { name: "Dozens", code: "DOZ" },
      { name: "Sets", code: "SET" },
      { name: "Bags", code: "BAG" },
      { name: "Bottles", code: "BTL" },
      { name: "Cartons", code: "CTN" },
      { name: "Quintals", code: "QTL" },
      { name: "Tonnes", code: "TON" },
      { name: "Square feet", code: "SQF" },
      { name: "Square metres", code: "SQM" },
      { name: "Units", code: "UNT" },
      { name: "Others", code: "OTH" },
    ]);
  }
  const [hasCats] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerCategories);
  if (hasCats.n === 0) {
    const expense = ["Rent", "Salaries & wages", "Electricity", "Transport & freight", "Office supplies", "Phone & internet", "Repairs & maintenance", "Travel", "Bank charges", "Miscellaneous"];
    const income = ["Interest received", "Commission received", "Discount received", "Other income"];
    await db.insert(ledgerCategories).values([
      ...expense.map((name) => ({ kind: "expense" as const, name })),
      ...income.map((name) => ({ kind: "income" as const, name })),
    ]);
  }
  const [hasAccounts] = await db.select({ n: sql<number>`count(*)::int` }).from(accounts);
  if (hasAccounts.n === 0) {
    await db.insert(accounts).values({ kind: "cash", name: "Cash in hand", isDefault: true });
  }
}
