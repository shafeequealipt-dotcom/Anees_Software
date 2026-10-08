import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, firms, partnerPayouts, partnerPromotions, partners, roles, users, vouchers } from "@/db/schema";
import { compactViews, financialYearLabel, groupViews, invoiceSequence, nextInvoiceSequence, paymentToLine, payoutInvoiceNo, rupeesInWords, viewsAmountPaise } from "@/lib/payout";
import { can } from "@/lib/permissions";
import { canSeeVoucher } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { createCompany } from "@/server/admin";
import { exportAllData, restoreAllData } from "@/server/data-backup";
import {
  addPromotion,
  createPayoutLink,
  exportPartnerSheet,
  loadPayoutInvoice,
  partnerGrowth,
  partnerHistory,
  partnerSheet,
  payPartner,
  removePromotion,
  resolvePayoutLink,
  savePartner,
  savePayoutInvoice,
  savePayoutSettings,
  saveViews,
  setPartnersEnabled,
  suggestInvoiceNo,
} from "@/server/partners";
import { cancelVoucher } from "@/server/vouchers";
import { renderPayoutInvoicePdf } from "@/server/pdf/payout-invoice-pdf";
import { dayBook, listVouchers } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let otherFirm: number;
let owner: { id: number };
let cashId: number;

const MONTH = "2026-10";
const base = { kind: "national" as const, ratePerMillionPaise: 40_000 };
const add = (name: string, extra: Record<string, unknown> = {}, firm = firmId) => savePartner(db, firm, { ...base, name, ...extra }, owner.id);

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Orpheus Test", country: "IN", stateCode: "32", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  [owner] = await db.select({ id: users.id }).from(users);
  otherFirm = await createCompany(db, { name: "Other Co", country: "IN", taxId: "", stateCode: "27" }, { id: owner.id, isOwner: true, firms: [], permissions: [] });
  [{ id: cashId }] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.firmId, firmId));
});

describe("the sums and wording", () => {
  it("works out views × rate in whole rupees, as the old generator did", () => {
    expect(viewsAmountPaise(42_500_000, 40_000)).toBe(1_700_000);
    expect(viewsAmountPaise(1_250_000, 40_000)).toBe(50_000);
    expect(viewsAmountPaise(1_234_567, 40_000)).toBe(49_400); // ₹493.8 → ₹494
    expect(viewsAmountPaise(0, 40_000)).toBe(0);
    expect(viewsAmountPaise(5_000_000, 0)).toBe(0);
  });

  it("shows views in international grouping with a short form", () => {
    expect(groupViews(42_500_000)).toBe("42,500,000");
    expect(compactViews(42_500_000)).toBe("42.5M");
    expect(compactViews(750_000)).toBe("750K");
    expect(compactViews(999_999)).toBe("1M");
    expect(compactViews(9_999)).toBeNull();
  });

  it("numbers invoices by Indian financial year", () => {
    expect(financialYearLabel("2026-10-08")).toBe("2026-27");
    expect(financialYearLabel("2027-03-31")).toBe("2026-27");
    expect(financialYearLabel("2027-04-01")).toBe("2027-28");
    expect(payoutInvoiceNo("ORP", "2026-10-08", 4)).toBe("ORP/2026-27/004");
    expect(invoiceSequence("ORP/2026-27/004")).toBe(4);
    expect(nextInvoiceSequence(["ORP/2026-27/001", "orp/2026-27/007", "ORP/2025-26/090", "X/2026-27/500"], "ORP", "2026-10-08")).toBe(8);
    expect(nextInvoiceSequence(["ORP/2026-27/007"], "ORP", "2027-04-02")).toBe(1);
  });

  it("writes the total in words and the payment line from bank details", () => {
    expect(rupeesInWords(1_700_000)).toBe("Rupees Seventeen Thousand Only");
    expect(paymentToLine({ kind: "national", upiId: "a@upi", bankName: "SBI", bankAccountNo: "123", bankIfsc: "SBIN0001" })).toBe("a@upi · SBI · A/c 123 · IFSC SBIN0001");
    expect(paymentToLine({ kind: "international", upiId: "ignored@upi", bankName: "Chase", bankAccountNo: "999", bankSwift: "CHASUS33", bankIban: "GB00" })).toBe("Chase · A/c 999 · IBAN GB00 · SWIFT CHASUS33");
  });
});

describe("who gets the permission", () => {
  it("the built-in Company owner role has it after the upgrade, and the Owner always does", async () => {
    const [co] = await db.select().from(roles).where(eq(roles.name, "Company owner"));
    expect((co.permissions as string[]).includes("partners.manage")).toBe(true);
    const [ownerRole] = await db.select().from(roles).where(eq(roles.isOwner, true));
    expect(can({ permissions: ownerRole.permissions, isOwner: true } as never, "partners.manage")).toBe(true);
    const others = await db.select().from(roles).where(eq(roles.isOwner, false));
    expect(others.filter((r) => (r.permissions as string[]).includes("partners.manage")).map((r) => r.name)).toEqual(["Company owner"]);
  });
});

describe("only for companies with Partners switched on", () => {
  it("refuses everything until the Owner turns it on", async () => {
    await expect(add("Ravi")).rejects.toThrow(/isn't turned on/);
    await expect(saveViews(db, firmId, { partnerId: 1, month: MONTH, views: 1 }, owner.id)).rejects.toThrow(/isn't turned on/);
    await setPartnersEnabled(db, firmId, true, owner.id);
    expect(await add("Ravi")).toBeGreaterThan(0);
  });

  it("stays off for other companies", async () => {
    await expect(add("Sneaky", {}, otherFirm)).rejects.toThrow(/isn't turned on/);
  });
});

describe("onboarding", () => {
  it("gives partners their next number, accepts a typed ID and refuses a clash", async () => {
    const [ravi] = await db.select().from(partners).where(eq(partners.name, "Ravi"));
    expect(ravi.code).toBe("1");
    const typed = await add("Meera", { code: "TT-9", channelName: "TechTalk", handle: "@techtalk" });
    expect((await db.select().from(partners).where(eq(partners.id, typed)))[0].code).toBe("TT-9");
    const next = await add("Sam");
    expect((await db.select().from(partners).where(eq(partners.id, next)))[0].code).toBe("2");
    await expect(add("Dup", { code: "tt-9" })).rejects.toThrow(/Partner ID "tt-9" is already used by "Meera"/);
  });

  it("keeps an international partner's bank set and drops the national one", async () => {
    await expect(add("Lena", { kind: "international" })).rejects.toThrow(/country/i);
    const id = await add("Lena", { kind: "international", country: "Germany", bankSwift: "DEUTDEFF", bankIban: "DE89", bankIfsc: "SHOULD-DROP", upiId: "drop@upi" });
    const [p] = await db.select().from(partners).where(eq(partners.id, id));
    expect(p).toMatchObject({ kind: "international", country: "Germany", bankSwift: "DEUTDEFF", bankIban: "DE89", bankIfsc: null, upiId: null });
    const nat = await add("Arjun", { country: "India", bankSwift: "DROP", bankIfsc: "SBIN0001" });
    expect((await db.select().from(partners).where(eq(partners.id, nat)))[0]).toMatchObject({ country: null, bankSwift: null, bankIfsc: "SBIN0001" });
  });

  it("keeps the ID when an edit leaves it blank", async () => {
    const [ravi] = await db.select().from(partners).where(eq(partners.name, "Ravi"));
    await savePartner(db, firmId, { ...base, id: ravi.id, name: "Ravi K", phone: "9876543210" }, owner.id);
    expect((await db.select().from(partners).where(eq(partners.id, ravi.id)))[0]).toMatchObject({ code: "1", name: "Ravi K", phone: "9876543210" });
  });

  it("refuses a bad email", async () => {
    await expect(add("Bad", { email: "not-an-email" })).rejects.toThrow(/email/i);
  });
});

describe("the month sheet", () => {
  let ravi: number;
  let meera: number;
  beforeAll(async () => {
    ravi = (await db.select().from(partners).where(eq(partners.name, "Ravi K")))[0].id;
    meera = (await db.select().from(partners).where(eq(partners.name, "Meera")))[0].id;
  });

  it("works out the amount from views and the partner's rate", async () => {
    await saveViews(db, firmId, { partnerId: ravi, month: MONTH, views: 42_500_000 }, owner.id);
    const row = (await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === ravi)!;
    expect(row).toMatchObject({ views: 42_500_000, rateUsedPaise: 40_000, viewsAmountPaise: 1_700_000, promotionsPaise: 0, totalPaise: 1_700_000, paidPaise: 0, duePaise: 1_700_000 });
  });

  it("keeps a hand-corrected amount", async () => {
    await saveViews(db, firmId, { partnerId: meera, month: MONTH, views: 1_000_000, amountPaise: 55_000 }, owner.id);
    expect((await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === meera)!.viewsAmountPaise).toBe(55_000);
  });

  it("a later change to the partner's rate leaves past months alone", async () => {
    const [p] = await db.select().from(partners).where(eq(partners.id, ravi));
    await savePartner(db, firmId, { ...base, id: ravi, name: p.name, ratePerMillionPaise: 90_000 }, owner.id);
    const oct = (await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === ravi)!;
    expect(oct).toMatchObject({ rateUsedPaise: 40_000, viewsAmountPaise: 1_700_000 });
    await saveViews(db, firmId, { partnerId: ravi, month: "2026-11", views: 1_000_000 }, owner.id);
    expect((await partnerSheet(db, firmId, "2026-11")).rows.find((r) => r.partnerId === ravi)!).toMatchObject({ rateUsedPaise: 90_000, viewsAmountPaise: 90_000 });
    await savePartner(db, firmId, { ...base, id: ravi, name: p.name, ratePerMillionPaise: 40_000 }, owner.id);
  });

  it("adds promotions to the total, and takes them away again", async () => {
    await addPromotion(db, firmId, { partnerId: ravi, month: MONTH, description: "Instagram reel campaign", amountPaise: 1_500_000 }, owner.id);
    await addPromotion(db, firmId, { partnerId: ravi, month: MONTH, description: "Shorts push", amountPaise: 100_000 }, owner.id);
    let row = (await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === ravi)!;
    expect(row).toMatchObject({ promotionsPaise: 1_600_000, totalPaise: 3_300_000 });
    await removePromotion(db, firmId, row.promotions.find((x) => x.description === "Shorts push")!.id, owner.id);
    row = (await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === ravi)!;
    expect(row).toMatchObject({ promotionsPaise: 1_500_000, totalPaise: 3_200_000 });
    await expect(addPromotion(db, firmId, { partnerId: ravi, month: MONTH, description: "", amountPaise: 5 }, owner.id)).rejects.toThrow(/Describe/);
  });

  it("lists a partner with nothing entered yet, and not one who joined later", async () => {
    const future = await add("Future", { joinedOn: "2027-01-01" });
    const rows = (await partnerSheet(db, firmId, MONTH)).rows;
    expect(rows.some((r) => r.partnerId === future)).toBe(false);
    expect(rows.find((r) => r.name === "Sam")).toMatchObject({ totalPaise: 0, views: 0 });
  });

  it("pays in parts, refuses too much, and shows what is still due", async () => {
    const res = await payPartner(db, firmId, { partnerId: ravi, month: MONTH, amountPaise: 1_000_000, date: "2026-10-10", accountId: cashId }, owner.id);
    const [v] = await db.select().from(vouchers).where(eq(vouchers.id, res.id));
    expect(v).toMatchObject({ type: "expense", partnerId: ravi, payMonth: MONTH, totalPaise: 1_000_000, status: "active" });
    let row = (await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === ravi)!;
    expect(row).toMatchObject({ paidPaise: 1_000_000, duePaise: 2_200_000 });
    await expect(payPartner(db, firmId, { partnerId: ravi, month: MONTH, amountPaise: 2_200_001, date: "2026-10-11", accountId: cashId }, owner.id)).rejects.toThrow(/more than the .* still due/);
    await payPartner(db, firmId, { partnerId: ravi, month: MONTH, amountPaise: 2_200_000, date: "2026-10-12", accountId: cashId }, owner.id);
    row = (await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === ravi)!;
    expect(row.duePaise).toBe(0);
    await expect(payPartner(db, firmId, { partnerId: ravi, month: MONTH, amountPaise: 100, date: "2026-10-12", accountId: cashId }, owner.id)).rejects.toThrow(/paid in full/);
  });

  it("refuses to pay when nothing has been entered", async () => {
    const sam = (await db.select().from(partners).where(eq(partners.name, "Sam")))[0].id;
    await expect(payPartner(db, firmId, { partnerId: sam, month: MONTH, amountPaise: 100, date: "2026-10-12", accountId: cashId }, owner.id)).rejects.toThrow(/nothing to pay/);
  });

  it("a cancelled payment becomes due again", async () => {
    const [last] = await db.select().from(vouchers).where(and(eq(vouchers.partnerId, ravi), eq(vouchers.totalPaise, 2_200_000)));
    await cancelVoucher(db, firmId, last.id, owner.id);
    expect((await partnerSheet(db, firmId, MONTH)).rows.find((r) => r.partnerId === ravi)!.duePaise).toBe(2_200_000);
  });

  it("the payment is an ordinary expense in a Partner payments category", async () => {
    const list = await listVouchers(db, firmId, { types: ["expense"] });
    expect(list.length).toBeGreaterThan(0);
    const [v] = await db.select().from(vouchers).where(and(eq(vouchers.partnerId, ravi), eq(vouchers.status, "active")));
    expect(v.categoryId).not.toBeNull();
  });

  it("exports the month with bank details for the transfers", async () => {
    const rows = await exportPartnerSheet(db, firmId, MONTH);
    const r = rows.find((x) => x.code === "1")!;
    expect(r).toMatchObject({ total: 32_000, views: 42_500_000, rate: 400, viewsAmount: 17_000, promoAmount: 15_000 });
    expect(r.promoDetail).toBe("Instagram reel campaign — ₹15000");
    expect(rows.some((x) => x.channel === "Sam")).toBe(false);
  });

  it("keeps a month-by-month history", async () => {
    const h = await partnerHistory(db, firmId, ravi);
    expect(h.map((x) => x.month)).toEqual(["2026-11", "2026-10"]);
    expect(h[1]).toMatchObject({ views: 42_500_000, totalPaise: 3_200_000 });
  });
});

describe("payout invoices", () => {
  let ravi: number;
  let meera: number;
  beforeAll(async () => {
    ravi = (await db.select().from(partners).where(eq(partners.name, "Ravi K")))[0].id;
    meera = (await db.select().from(partners).where(eq(partners.name, "Meera")))[0].id;
  });
  const inv = (partnerId: number, extra: Record<string, unknown> = {}) => savePayoutInvoice(db, firmId, { partnerId, month: MONTH, date: "2026-10-31", ...extra }, owner.id);

  it("numbers the first invoice ORP/2026-27/001 and carries on", async () => {
    expect(await suggestInvoiceNo(db, firmId, "2026-10-31")).toBe("ORP/2026-27/001");
    const a = await inv(ravi);
    expect(a).toMatchObject({ invoiceNo: "ORP/2026-27/001", created: true });
    const b = await inv(meera);
    expect(b.invoiceNo).toBe("ORP/2026-27/002");
  });

  it("saving the same month again updates the invoice and keeps its number", async () => {
    const again = await inv(ravi, { period: "October 2026 (revised)" });
    expect(again).toMatchObject({ invoiceNo: "ORP/2026-27/001", created: false });
    const [p] = await db.select().from(partnerPayouts).where(eq(partnerPayouts.id, again.payoutId));
    expect(p.period).toBe("October 2026 (revised)");
    expect((await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.partnerId, ravi), eq(partnerPayouts.month, MONTH)))).length).toBe(1);
  });

  it("accepts a typed number, then continues after it, and refuses one already used", async () => {
    await savePartner(db, firmId, { ...base, name: "Zed" }, owner.id);
    const zed = (await db.select().from(partners).where(eq(partners.name, "Zed")))[0].id;
    await saveViews(db, firmId, { partnerId: zed, month: MONTH, views: 2_000_000 }, owner.id);
    const typed = await inv(zed, { invoiceNo: "ORP/2026-27/040" });
    expect(typed.invoiceNo).toBe("ORP/2026-27/040");
    expect(await suggestInvoiceNo(db, firmId, "2026-10-31")).toBe("ORP/2026-27/041");
    await expect(inv(meera, { invoiceNo: "orp/2026-27/040" })).rejects.toThrow(/already used/);
    expect(await suggestInvoiceNo(db, firmId, "2027-05-01")).toBe("ORP/2027-28/001");
  });

  it("two invoices made at the same moment never share a number", async () => {
    const ids: number[] = [];
    for (let n = 0; n < 5; n++) {
      const id = await savePartner(db, firmId, { ...base, name: `Rush ${n}` }, owner.id);
      await saveViews(db, firmId, { partnerId: id, month: MONTH, views: 1_000_000 }, owner.id);
      ids.push(id);
    }
    const made = await Promise.all(ids.map((id) => inv(id)));
    expect(new Set(made.map((m) => m.invoiceNo)).size).toBe(5);
  });

  it("refuses to invoice a month with nothing in it", async () => {
    const sam = (await db.select().from(partners).where(eq(partners.name, "Sam")))[0].id;
    await expect(inv(sam)).rejects.toThrow(/nothing to invoice/);
  });

  it("prints the views line, the promotion and the total", async () => {
    await savePayoutSettings(db, firmId, { payoutPrefix: "ORP", payoutLlpin: "ADB-1", payoutTan: "TAN1", payoutSignerName: "A Signer", payoutSignerRole: "Designated Partner", payoutShowSignature: true, payoutRatePerMillionPaise: 40_000, payoutViewsDescription: "Content ID views royalty share", payoutNotes: "Pay within 15 days." }, owner.id);
    await savePartner(db, firmId, { ...base, id: ravi, name: "Ravi K", channelName: "Don't Miss Bollywood", handle: "@dmb", upiId: "ravi@upi", bankAccountNo: "1234", bankIfsc: "SBIN0001", pan: "ABCDE1234F" }, owner.id);
    await inv(ravi);
    const [payout] = await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.partnerId, ravi), eq(partnerPayouts.month, MONTH)));
    const m = (await loadPayoutInvoice(db, firmId, payout.id))!.model;
    expect(m.invoiceNo).toBe("ORP/2026-27/001");
    expect(m.items.map((x) => [x.description, x.basis, x.amountPaise])).toEqual([
      ["Content ID views royalty share", "42,500,000 views (42.5M)", 1_700_000],
      ["Instagram reel campaign", "Agreed fee", 1_500_000],
    ]);
    expect(m.items[0].sub).toBe("@ ₹400.00 per 10,00,000 views");
    expect(m.totalPaise).toBe(3_200_000);
    expect(m.words).toBe("Rupees Thirty Two Thousand Only");
    expect(m.signer).toMatchObject({ name: "A Signer", role: "Designated Partner" });
    expect(m.company.idLine).toContain("LLPIN ADB-1");
    const pdf = await renderPayoutInvoicePdf(m);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("the payee on an old invoice doesn't change when the partner's bank does", async () => {
    const [payout] = await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.partnerId, ravi), eq(partnerPayouts.month, MONTH)));
    const before = (await loadPayoutInvoice(db, firmId, payout.id))!.model.payee.lines.join("|");
    expect(before).toContain("Payment to: ravi@upi");
    await savePartner(db, firmId, { ...base, id: ravi, name: "Ravi K", channelName: "Don't Miss Bollywood", upiId: "new@upi" }, owner.id);
    expect((await loadPayoutInvoice(db, firmId, payout.id))!.model.payee.lines.join("|")).toBe(before);
  });

  it("another company cannot reach this company's invoice", async () => {
    const [payout] = await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.partnerId, ravi), eq(partnerPayouts.month, MONTH)));
    expect(await loadPayoutInvoice(db, otherFirm, payout.id)).toBeNull();
  });
});

describe("private links for WhatsApp", () => {
  it("opens one invoice without signing in, and nothing else", async () => {
    const [payout] = await db.select().from(partnerPayouts).where(eq(partnerPayouts.invoiceNo, "ORP/2026-27/001"));
    const token = await createPayoutLink(db, firmId, payout.id, owner.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(await createPayoutLink(db, firmId, payout.id, owner.id)).toBe(token);
    expect(await resolvePayoutLink(db, token)).toEqual({ payoutId: payout.id, firmId });
    expect(await resolvePayoutLink(db, "nope")).toBeNull();
    expect(await resolvePayoutLink(db, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
  });

  it("refuses to make a link before there is an invoice", async () => {
    const sam = (await db.select().from(partners).where(eq(partners.name, "Sam")))[0].id;
    await saveViews(db, firmId, { partnerId: sam, month: "2026-09", views: 1_000_000 }, owner.id);
    const [p] = await db.select().from(partnerPayouts).where(and(eq(partnerPayouts.partnerId, sam), eq(partnerPayouts.month, "2026-09")));
    await expect(createPayoutLink(db, firmId, p.id, owner.id)).rejects.toThrow(/Make the invoice first/);
  });

  it("does not open once it has expired", async () => {
    const { partnerPayoutLinks } = await import("@/db/schema");
    const [payout] = await db.select().from(partnerPayouts).where(eq(partnerPayouts.invoiceNo, "ORP/2026-27/001"));
    await db.insert(partnerPayoutLinks).values({ token: "expired-token-0123456789", payoutId: payout.id, expiresAt: new Date(Date.now() - 1000) });
    expect(await resolvePayoutLink(db, "expired-token-0123456789")).toBeNull();
  });
});

describe("privacy", () => {
  const someone = (permissions: string[]) => ({ id: 99, isOwner: false, allLocations: true, locations: [], permissions }) as never;
  it("payments to partners are hidden from people without the permission", async () => {
    const [v] = await db.select().from(vouchers).where(and(eq(vouchers.firmId, firmId), eq(vouchers.status, "active"), eq(vouchers.type, "expense")));
    const row = { locationId: null, createdBy: null, partnerId: 5, employeeId: null };
    void v;
    expect(canSeeVoucher(someone([]), row)).toBe(false);
    expect(canSeeVoucher(someone(["staff.manage"]), row)).toBe(false);
    expect(canSeeVoucher(someone(["partners.manage"]), row)).toBe(true);
    expect(can(someone(["partners.manage"]), "partners.manage")).toBe(true);
  });

  it("are left out of the lists and day book when asked to hide them", async () => {
    const all = await listVouchers(db, firmId, { types: ["expense"] });
    const hidden = await listVouchers(db, firmId, { types: ["expense"], hidePartners: true });
    expect(all.length).toBeGreaterThan(hidden.length);
    expect(hidden.every((x) => x.id !== undefined)).toBe(true);
    const book = await dayBook(db, firmId, "2026-10-01", "2026-10-31");
    const bookHidden = await dayBook(db, firmId, "2026-10-01", "2026-10-31", undefined, { hidePartners: true });
    expect(book.length).toBeGreaterThan(bookHidden.length);
  });
});

describe("growth figures", () => {
  it("counts partners by the month they joined, with a running total", async () => {
    const co = await createCompany(db, { name: "Growth Co", country: "IN", taxId: "", stateCode: "32" }, { id: owner.id, isOwner: true, firms: [], permissions: [] });
    await setPartnersEnabled(db, co, true, owner.id);
    const mk = (name: string, joinedOn: string, extra: Record<string, unknown> = {}) => savePartner(db, co, { ...base, name, joinedOn, ...extra }, owner.id);
    await mk("Old one", "2024-03-10");
    await mk("A", "2026-08-05");
    await mk("B", "2026-08-20", { kind: "international", country: "UAE" });
    await mk("C", "2026-10-01");
    const gone = await mk("D", "2026-10-07", { kind: "international", country: "UK" });
    await savePartner(db, co, { ...base, id: gone, name: "D", kind: "international", country: "UK", joinedOn: "2026-10-07", active: false }, owner.id);

    const g = await partnerGrowth(db, co, "2026-10-08");
    expect(g).toMatchObject({ total: 5, active: 4, national: 3, international: 2, addedThisMonth: 2, addedLastMonth: 0 });
    expect(g.months).toHaveLength(12);
    expect(g.months[0].month).toBe("2025-11");
    expect(g.months[0]).toMatchObject({ added: 0, total: 1 }); // the 2024 partner is already there
    expect(g.months.find((m) => m.month === "2026-08")).toEqual({ month: "2026-08", national: 1, international: 1, added: 2, total: 3 });
    expect(g.months.find((m) => m.month === "2026-09")).toMatchObject({ added: 0, total: 3 });
    expect(g.months.at(-1)).toEqual({ month: "2026-10", national: 1, international: 1, added: 2, total: 5 });
    // Another company's partners are not counted.
    expect((await partnerGrowth(db, otherFirm, "2026-10-08")).total).toBe(0);
  });
});

describe("backup and restore", () => {
  it("a company backup carries its partners, months, promotions and payments", async () => {
    const [me] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
    const { buffer } = await exportAllData(db, [firmId], me);
    const res = await restoreAllData(db, buffer, { id: me.id, isOwner: true });
    const copy = res.companies[0].id;
    const orig = await db.select().from(partners).where(eq(partners.firmId, firmId));
    const back = await db.select().from(partners).where(eq(partners.firmId, copy));
    expect(back.map((x) => [x.code, x.name, x.kind]).sort()).toEqual(orig.map((x) => [x.code, x.name, x.kind]).sort());
    const payouts = await db.select().from(partnerPayouts).where(eq(partnerPayouts.firmId, copy));
    expect(payouts.length).toBe((await db.select().from(partnerPayouts).where(eq(partnerPayouts.firmId, firmId))).length);
    const ravi = back.find((x) => x.name === "Ravi K")!;
    const oct = payouts.find((x) => x.partnerId === ravi.id && x.month === MONTH)!;
    expect(oct).toMatchObject({ views: 42_500_000, viewsAmountPaise: 1_700_000, invoiceNo: "ORP/2026-27/001" });
    expect((await db.select().from(partnerPromotions).where(eq(partnerPromotions.payoutId, oct.id))).map((x) => x.description)).toEqual(["Instagram reel campaign"]);
    // The payments still point at the copied partner, not the original.
    const paid = await db.select().from(vouchers).where(and(eq(vouchers.firmId, copy), eq(vouchers.partnerId, ravi.id)));
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every((v) => v.payMonth === MONTH)).toBe(true);
  });
});

describe("switching off", () => {
  it("stops everything again, and keeps the data", async () => {
    await saveSettings(db, firmId, { partnersEnabled: false });
    await expect(add("Late")).rejects.toThrow(/isn't turned on/);
    await expect(createPayoutLink(db, firmId, 1, owner.id)).rejects.toThrow(/isn't turned on/);
    expect((await db.select().from(partners).where(eq(partners.firmId, firmId))).length).toBeGreaterThan(5);
    await saveSettings(db, firmId, { partnersEnabled: true });
  });
});
