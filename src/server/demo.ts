import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, ledgerCategories, taxRates, units } from "@/db/schema";
import { addDays, todayIST } from "@/lib/dates";
import { accountSchema, saveAccount, saveItem, saveParty } from "./masters";
import { needsSetup, runFirstSetup } from "./setup";
import { saveVoucher } from "./vouchers";

/**
 * Sample business for development and demos. Never runs in production — gated by
 * the environment checks in the /api/dev route that calls this.
 *
 * The login below is a known, fixed password (not a real secret) so it can be typed
 * into the actual sign-in screen during local testing. This only ever exists on a
 * developer's own machine, in the local embedded database — never on a deployed server.
 */
export const DEMO_EMAIL = "owner@demo.local";
export const DEMO_PASSWORD = "Sharma-Temp-2026";

export async function seedDemo(db: DB) {
  if (!(await needsSetup(db))) return false;
  await runFirstSetup(db, {
    businessName: "Sharma Stationery Mart",
    gstin: "27AAPCS1234K1Z" + (await import("@/lib/gst/gstin")).gstinCheckDigit("27AAPCS1234K1Z"),
    gstScheme: "regular",
    stateCode: "27",
    address: "Shop 12, Laxmi Road\nPune 411030",
    phone: "020 2445 1122",
    ownerName: "Demo Owner",
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  const rates = await db.select().from(taxRates);
  const r = (bp: number) => rates.find((x) => x.gstBp === bp && x.nature === "taxable")!.id;
  const u = await db.select().from(units);
  const unit = (c: string) => u.find((x) => x.code === c)!.id;
  const [cash] = await db.select().from(accounts).where(eq(accounts.kind, "cash"));
  const bank = await saveAccount(db, accountSchema.parse({ kind: "bank", name: "HDFC Current A/c", bankName: "HDFC Bank", accountNo: "50200012345678", ifsc: "HDFC0000123", upiId: "sharmastationery@hdfcbank", openingBalancePaise: 18_500_000, isDefault: true }) as never, 1);

  const today = todayIST();
  const d = (n: number) => addDays(today, -n);

  const c1 = await saveParty(db, { kind: "customer", name: "Vidya Bharati School", phone: "9822012345", gstin: "27AAATV1234B1Z" + (await import("@/lib/gst/gstin")).gstinCheckDigit("27AAATV1234B1Z"), billingAddress: "Kothrud, Pune 411038", creditDays: 30, openingBalancePaise: 1_250_000 }, 1);
  const c2 = await saveParty(db, { kind: "customer", name: "Deccan Office Supplies", phone: "9890098900", stateCode: "27", billingAddress: "FC Road, Pune", creditDays: 15 }, 1);
  const c3 = await saveParty(db, { kind: "customer", name: "Bengaluru Book House", phone: "9845011122", stateCode: "29", billingAddress: "MG Road, Bengaluru 560001" }, 1);
  const s1 = await saveParty(db, { kind: "supplier", name: "Camlin Distributors", phone: "9823456789", stateCode: "27", openingBalancePaise: -840_000, creditDays: 45 }, 1);
  const s2 = await saveParty(db, { kind: "supplier", name: "Classmate Paper Co.", phone: "9811223344", stateCode: "07", billingAddress: "Okhla, New Delhi" }, 1);

  const pen = await saveItem(db, { name: "Gel pen blue", code: "GP-BL", hsn: "9608", unitId: unit("PCS"), altUnitId: unit("BOX"), altUnitFactorMilli: 20_000, salePricePaise: 1_000, purchasePricePaise: 620, taxRateId: r(1800), openingQtyMilli: 800_000, openingRatePaise: 620, minStockMilli: 200_000 }, 1);
  const note = await saveItem(db, { name: "Notebook 200 pages", code: "NB-200", hsn: "4820", unitId: unit("PCS"), salePricePaise: 6_500, purchasePricePaise: 4_200, taxRateId: r(500), openingQtyMilli: 300_000, openingRatePaise: 4_200, minStockMilli: 50_000 }, 1);
  const a4 = await saveItem(db, { name: "A4 copier paper 500 sheets", code: "A4-500", hsn: "4802", unitId: unit("PAC"), salePricePaise: 32_000, purchasePricePaise: 25_500, taxRateId: r(1800), openingQtyMilli: 60_000, openingRatePaise: 25_500, minStockMilli: 40_000 }, 1);
  const geo = await saveItem(db, { name: "Geometry box", code: "GEO-01", hsn: "9017", unitId: unit("PCS"), salePricePaise: 18_000, salePriceIncludesTax: true, purchasePricePaise: 11_000, taxRateId: r(1800), openingQtyMilli: 45_000, openingRatePaise: 11_000, minStockMilli: 10_000 }, 1);
  const bind = await saveItem(db, { kind: "service", name: "Spiral binding", hsn: "998912", salePricePaise: 4_000, taxRateId: r(1800) }, 1);

  const [rent] = await db.select().from(ledgerCategories).where(eq(ledgerCategories.name, "Rent"));
  const [elec] = await db.select().from(ledgerCategories).where(eq(ledgerCategories.name, "Electricity"));

  const line = (itemId: number, description: string, qty: number, rate: number, tax: number, extra: object = {}) => ({ itemId, description, qtyMilli: qty * 1000, ratePaise: rate, taxRateId: r(tax), ...extra });

  await saveVoucher(db, { type: "purchase_bill", date: d(40), partyId: s1, supplierInvoiceNo: "CD/2291", lines: [line(pen, "Gel pen blue", 25, 12_400, 1800, { unitFactorMilli: 20_000, unitCode: "BOX" }), line(geo, "Geometry box", 30, 11_000, 1800)] }, 1);
  await saveVoucher(db, { type: "purchase_bill", date: d(33), partyId: s2, supplierInvoiceNo: "CPC-7781", lines: [line(note, "Notebook 200 pages", 400, 4_200, 500)] }, 1);
  const inv1 = await saveVoucher(db, { type: "sale_invoice", date: d(28), partyId: c1, lines: [line(note, "Notebook 200 pages", 250, 6_000, 500), line(pen, "Gel pen blue", 10, 19_000, 1800, { unitFactorMilli: 20_000, unitCode: "BOX" }), line(geo, "Geometry box", 40, 17_000, 1800, { rateIncludesTax: true })] }, 1);
  await saveVoucher(db, { type: "sale_invoice", date: d(20), partyId: c2, paidPaise: 500_000, accountId: bank, paymentMode: "UPI", lines: [line(a4, "A4 copier paper 500 sheets", 30, 31_000, 1800), line(bind, "Spiral binding", 25, 4_000, 1800)] }, 1);
  await saveVoucher(db, { type: "sale_invoice", date: d(12), partyId: c3, lines: [line(note, "Notebook 200 pages", 120, 6_200, 500)] }, 1);
  await saveVoucher(db, { type: "sale_invoice", date: d(2), partyName: "Walk-in customer", accountId: cash.id, lines: [line(pen, "Gel pen blue", 12, 1_000, 1800, { rateIncludesTax: true }), line(note, "Notebook 200 pages", 3, 6_500, 500, { rateIncludesTax: true })] }, 1);
  await saveVoucher(db, { type: "sale_invoice", date: today, partyId: c2, lines: [line(a4, "A4 copier paper 500 sheets", 10, 32_000, 1800)] }, 1);
  await saveVoucher(db, { type: "payment_in", date: d(8), partyId: c1, amountPaise: 1_000_000, accountId: bank, paymentMode: "Cheque", paymentRef: "004512" }, 1);
  await saveVoucher(db, { type: "payment_out", date: d(5), partyId: s1, amountPaise: 840_000, accountId: bank, paymentMode: "Bank transfer", paymentRef: "UTR 4581223" }, 1);
  await saveVoucher(db, { type: "quotation", date: d(3), dueDate: addDays(today, 12), partyId: c1, lines: [line(a4, "A4 copier paper 500 sheets", 50, 30_500, 1800)] }, 1);
  await saveVoucher(db, { type: "expense", date: d(10), categoryId: rent.id, accountId: bank, paymentMode: "Bank transfer", lines: [{ description: "Shop rent", qtyMilli: 1000, ratePaise: 2_500_000 }] }, 1);
  await saveVoucher(db, { type: "expense", date: d(6), categoryId: elec.id, accountId: cash.id, lines: [{ description: "MSEB electricity bill", qtyMilli: 1000, ratePaise: 318_000 }] }, 1);
  await saveVoucher(db, { type: "credit_note", date: d(7), partyId: c1, sourceVoucherId: inv1.id, lines: [line(geo, "Geometry box", 2, 17_000, 1800, { rateIncludesTax: true })] }, 1);
  return true;
}
