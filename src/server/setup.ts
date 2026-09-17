import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { accounts, firms, ledgerCategories, taxRates, units, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/auth";
import { checkGstin } from "@/lib/gst/gstin";
import { isValidStateCode } from "@/lib/gst/states";
import { MasterError } from "./masters";

export async function needsSetup(db: DB): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row.n === 0;
}

export const setupSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your business name.").max(200),
  gstin: z.string().trim().max(15).optional().transform((v) => (v ? v.toUpperCase() : null)),
  gstScheme: z.enum(["regular", "composition", "unregistered"]).default("regular"),
  stateCode: z.string().refine(isValidStateCode, "Choose your state."),
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
  if (input.gstin) {
    const g = checkGstin(input.gstin);
    if (!g.ok) throw new MasterError(g.reason, "gstin");
    if (g.stateCode !== input.stateCode) throw new MasterError("The GSTIN's state doesn't match the state you chose.", "stateCode");
  }
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (count.n > 0) throw new MasterError("Setup has already been completed. Sign in instead.");

    await tx.insert(firms).values({
      name: input.businessName,
      gstin: input.gstin,
      pan: input.gstin ? input.gstin.slice(2, 12) : null,
      gstScheme: input.gstin ? input.gstScheme : "unregistered",
      stateCode: input.stateCode,
      address: input.address || null,
      phone: input.phone || null,
      email: input.email,
      isDefault: true,
    });
    const [owner] = await tx
      .insert(users)
      .values({ name: input.ownerName, email: input.email, passwordHash, role: "owner" })
      .returning({ id: users.id });

    await seedDefaults(tx as unknown as DB);
    await audit(tx, { userId: owner.id, action: "create", entity: "setup", summary: `Business "${input.businessName}" set up by ${input.ownerName}` });
    return owner.id;
  });
}

/** Tax rates, units, categories and a cash account every business needs. Safe to run once. */
export async function seedDefaults(db: DB) {
  const [hasRates] = await db.select({ n: sql<number>`count(*)::int` }).from(taxRates);
  if (hasRates.n === 0) {
    await db.insert(taxRates).values([
      { name: "GST 0%", gstBp: 0, nature: "taxable", sort: 10 },
      { name: "Exempt", gstBp: 0, nature: "exempt", sort: 11 },
      { name: "Nil rated", gstBp: 0, nature: "nil", sort: 12 },
      { name: "Non-GST", gstBp: 0, nature: "non_gst", sort: 13 },
      { name: "GST 0.25%", gstBp: 25, sort: 20 },
      { name: "GST 3%", gstBp: 300, sort: 30 },
      { name: "GST 5%", gstBp: 500, sort: 40 },
      { name: "GST 18%", gstBp: 1800, sort: 60 },
      { name: "GST 40%", gstBp: 4000, sort: 80 },
      // Older slabs, off by default; switch on in Settings › Tax rates if your goods still use them.
      { name: "GST 12%", gstBp: 1200, sort: 50, active: false },
      { name: "GST 28%", gstBp: 2800, sort: 70, active: false },
    ]);
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
