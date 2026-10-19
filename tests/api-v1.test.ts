import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, auditLog, firms, items, moneyLedger, parties, stockLedger, users, vouchers } from "@/db/schema";
import { gstinCheckDigit } from "@/lib/gst/gstin";
import { setRegion } from "@/lib/region";
import { createCompany } from "@/server/admin";
import { createApiKey, revokeApiKey, verifyApiKey } from "@/server/api-keys";
import { apiReference, runBatch, type EntryResult } from "@/server/api-v1";
import { runFirstSetup } from "@/server/setup";
import { openBills, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let F: number;
let other: number;
let U: number;
let cash: number;
const ctx = () => ({ firmId: F, userId: U, keyName: "Test key" });
const by = (rs: EntryResult[], ref: string) => rs.find((r) => r.ref === ref)!;
/** Every account's balance (opening included), as the Cash & bank screen shows it. */
const accountBalances = async (_db: DB, firmId: number) => {
  const sums = await db
    .select({ id: moneyLedger.accountId, balancePaise: sql<number>`sum(${moneyLedger.amountPaise})::bigint`.mapWith(Number) })
    .from(moneyLedger)
    .innerJoin(accounts, eq(accounts.id, moneyLedger.accountId))
    .where(eq(accounts.firmId, firmId))
    .groupBy(moneyLedger.accountId);
  return (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.firmId, firmId))).map((a) => ({ id: a.id, balancePaise: sums.find((x) => x.id === a.id)?.balancePaise ?? 0 }));
};

/** One month from a bank statement plus a supplier bill, as the importer would send it. */
const GSTIN = "29ABCDE1234F1Z" + gstinCheckDigit("29ABCDE1234F1Z");
const month = () => [
  { kind: "bank_account", ref: "hdfc", name: "HDFC Current", bankName: "HDFC Bank", accountNo: "50200012345678", ifsc: "HDFC0001234", openingBalancePaise: 50_000_00, openingDate: "2026-09-01" },
  { kind: "party", ref: "sup-medi", name: "Medi Distributors", partyKind: "supplier", gstin: GSTIN },
  { kind: "party", ref: "cust-clinic", name: "Walk-in clinic", partyKind: "customer" },
  { kind: "item", ref: "it-gloves", name: "Nitrile gloves (100)", hsn: "40151900", unit: "BOX", gstRatePct: 18, purchasePricePaise: 400_00 },
  { kind: "item", ref: "it-mask", name: "Surgical mask (50)", hsn: "63079090", unit: "BOX", gstRatePct: 5, purchasePricePaise: 150_00 },
  {
    kind: "purchase_bill",
    ref: "bill-MD-881",
    date: "2026-09-03",
    party: { ref: "sup-medi" },
    billNo: "MD/881",
    lines: [
      { item: { ref: "it-gloves" }, qty: 10, ratePaise: 400_00, gstRatePct: 18 },
      { item: { ref: "it-mask" }, qty: 20, ratePaise: 150_00, gstRatePct: 5 },
    ],
    expectedTotalPaise: 7_870_00, // 4,000 + 18% + 3,000 + 5% = 4,720 + 3,150
  },
  { kind: "payment_out", ref: "hdfc-2026-09-10-1", date: "2026-09-10", party: { ref: "sup-medi" }, amountPaise: 7_870_00, account: { ref: "hdfc" }, paymentRef: "NEFT 1234" },
  { kind: "expense", ref: "hdfc-2026-09-30-1", date: "2026-09-30", category: "Bank charges", amountPaise: 118_00, account: { ref: "hdfc" } },
  { kind: "transfer", ref: "hdfc-2026-09-15-1", date: "2026-09-15", from: { ref: "hdfc" }, to: { name: "Cash in hand" }, amountPaise: 5_000_00 },
  { kind: "payment_in", ref: "hdfc-2026-09-20-1", date: "2026-09-20", party: { ref: "cust-clinic" }, amountPaise: 1_000_00, account: { ref: "hdfc" } },
];

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "DNH Test", country: "IN", stateCode: "29", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" } as never);
  setRegion("IN");
  [{ id: F }] = await db.select({ id: firms.id }).from(firms);
  [{ id: U }] = await db.select({ id: users.id }).from(users);
  [{ id: cash }] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, F), eq(accounts.kind, "cash")));
  other = await createCompany(db, { name: "Other Co", country: "IN", taxId: "", stateCode: "27" }, { id: U, isOwner: true, firms: [], permissions: [] });
});

describe("API keys", () => {
  it("are shown once, stored only as a hash, and stop working when revoked", async () => {
    const { id, token } = await createApiKey(db, F, "Claude bookkeeping", U);
    expect(token).toMatch(/^bk_/);
    expect(await verifyApiKey(db, token)).toMatchObject({ firmId: F, userId: U, keyName: "Claude bookkeeping" });
    expect(await verifyApiKey(db, token + "x")).toBeNull();
    expect(await verifyApiKey(db, "nonsense")).toBeNull();
    const stored = JSON.stringify(await db.select().from((await import("@/db/schema")).apiKeys));
    expect(stored).not.toContain(token);
    await revokeApiKey(db, id, "all", U);
    expect(await verifyApiKey(db, token)).toBeNull();
  });

  it("belong to one company: another company's key sees only its own records", async () => {
    const { token } = await createApiKey(db, other, "Other key", U);
    const who = (await verifyApiKey(db, token))!;
    expect(who.firmId).toBe(other);
    await saveVoucher(db, F, { type: "expense", date: "2026-09-02", paidPaise: 100, accountId: cash, lines: [{ description: "x", qtyMilli: 1000, ratePaise: 100 }] }, U);
    const ref = await apiReference(db, other);
    expect(ref.accounts.every((a) => a.id !== cash)).toBe(true);
    // A batch for the other company can't use this company's cash account by id.
    const out = await runBatch(db, { firmId: other, userId: U, keyName: "Other key" }, { dryRun: true, entries: [{ kind: "expense", ref: "x1", date: "2026-09-02", category: "Rent", amountPaise: 100, account: { id: cash } }] });
    expect(out.ok).toBe(false);
    expect(out.results[0].message).toMatch(/isn't in this company/);
  });
});

describe("a batch", () => {
  it("dry run checks everything and keeps nothing", async () => {
    const before = (await db.select().from(vouchers).where(eq(vouchers.firmId, F))).length;
    const out = await runBatch(db, ctx(), { dryRun: true, entries: month() });
    expect(out.ok).toBe(true);
    expect(out.results.map((r) => r.status)).toEqual(Array(10).fill("would_create"));
    expect((await db.select().from(vouchers).where(eq(vouchers.firmId, F))).length).toBe(before);
    expect(await db.select().from(parties).where(and(eq(parties.firmId, F), eq(parties.name, "Medi Distributors")))).toHaveLength(0);
  });

  it("one bad entry stops the whole batch", async () => {
    const bad = month();
    (bad[5] as { expectedTotalPaise: number }).expectedTotalPaise = 7_000_00;
    const out = await runBatch(db, ctx(), { dryRun: false, entries: bad });
    expect(out.ok).toBe(false);
    expect(by(out.results, "bill-MD-881")).toMatchObject({ status: "error" });
    expect(by(out.results, "bill-MD-881").message).toMatch(/7870\.00 in the app but 7000\.00/);
    expect(await db.select().from(accounts).where(and(eq(accounts.firmId, F), eq(accounts.name, "HDFC Current")))).toHaveLength(0);
  });

  it("enters the month: bank account, supplier, items, bill, payment, expense, transfer", async () => {
    const out = await runBatch(db, ctx(), { dryRun: false, entries: month() });
    expect(out.ok).toBe(true);
    expect(out.results.every((r) => r.status === "created")).toBe(true);
    const bill = by(out.results, "bill-MD-881");
    const [b] = await db.select().from(vouchers).where(eq(vouchers.id, bill.id!));
    expect(b).toMatchObject({ type: "purchase_bill", totalPaise: 7_870_00, supplierInvoiceNo: "MD/881", externalRef: "bill-MD-881" });
    // Intra-state (both Karnataka): CGST + SGST, no IGST.
    expect(b.igstPaise).toBe(0);
    expect(b.cgstPaise + b.sgstPaise).toBe(870_00);
    // Stock went up, and the payment settled the bill.
    const stock = await db.select().from(stockLedger).where(eq(stockLedger.voucherId, b.id));
    expect(stock.reduce((s, r) => s + r.qtyMilli, 0)).toBe(30_000);
    expect((await openBills(db, b.partyId!, ["purchase_bill"])).some((x) => x.id === b.id)).toBe(false);
    // Bank: 50,000 opening − 7,870 − 118 − 5,000 + 1,000 = 38,012.
    const bank = by(out.results, "hdfc").id!;
    const bal = (await accountBalances(db, F)).find((a) => a.id === bank);
    expect(bal?.balancePaise).toBe(38_012_00);
    expect(bill.link).toBe(`/purchases/${b.id}`);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.firmId, F), eq(auditLog.entity, "api_batch")));
    expect(log.summary).toMatch(/Via API key "Test key": 10 entered/);
  });

  it("sending the same batch again enters nothing", async () => {
    const before = (await db.select().from(vouchers).where(eq(vouchers.firmId, F))).length;
    const out = await runBatch(db, ctx(), { dryRun: false, entries: month() });
    expect(out.ok).toBe(true);
    expect(out.results.every((r) => r.status === "already_entered")).toBe(true);
    expect((await db.select().from(vouchers).where(eq(vouchers.firmId, F))).length).toBe(before);
    expect((await db.select().from(items).where(eq(items.firmId, F))).length).toBe(2);
  });

  it("flags a hand-made entry that looks the same", async () => {
    await saveVoucher(db, F, { type: "expense", date: "2026-10-01", partyName: "Landlord", paidPaise: 15_000_00, accountId: cash, roundOff: false, lines: [{ description: "Rent", qtyMilli: 1000, ratePaise: 15_000_00 }] }, U);
    const out = await runBatch(db, ctx(), { dryRun: true, entries: [{ kind: "expense", ref: "hdfc-2026-10-02-1", date: "2026-10-02", category: "Rent", amountPaise: 15_000_00, account: { name: "HDFC Current" }, payee: "Landlord" }] });
    expect(out.results[0].possibleDuplicates?.[0]).toMatchObject({ type: "expense", amountPaise: 15_000_00, date: "2026-10-01" });
  });

  it("relink moves a cash expense to the bank, and both balances follow", async () => {
    const [rent] = await db.select().from(vouchers).where(and(eq(vouchers.firmId, F), eq(vouchers.partyName, "Landlord")));
    const bankId = (await db.select().from(accounts).where(eq(accounts.name, "HDFC Current")))[0].id;
    const before = await accountBalances(db, F);
    const out = await runBatch(db, ctx(), { dryRun: false, entries: [{ kind: "relink", ref: "hdfc-2026-10-01-1", voucher: { number: `${rent.prefix}${rent.number}` }, account: { name: "HDFC Current" }, paymentMode: "Bank transfer" }] });
    expect(out.results[0]).toMatchObject({ status: "changed", message: "Cash in hand → HDFC Current" });
    const after = await accountBalances(db, F);
    const delta = (id: number) => after.find((a) => a.id === id)!.balancePaise - before.find((a) => a.id === id)!.balancePaise;
    expect(delta(cash)).toBe(15_000_00);
    expect(delta(bankId)).toBe(-15_000_00);
    expect((await db.select().from(moneyLedger).where(eq(moneyLedger.voucherId, rent.id)))[0].accountId).toBe(bankId);
    const again = await runBatch(db, ctx(), { dryRun: false, entries: [{ kind: "relink", ref: "hdfc-2026-10-01-1", voucher: { id: rent.id }, account: { name: "HDFC Current" } }] });
    expect(again.results[0].status).toBe("already_entered");
  });

  it("reports unknown things clearly", async () => {
    const out = await runBatch(db, ctx(), {
      dryRun: true,
      entries: [
        { kind: "payment_out", ref: "p1", date: "2026-10-03", party: { name: "Nobody Ltd" }, amountPaise: 100, account: { name: "HDFC Current" } },
        { kind: "item", ref: "i1", name: "Odd thing", gstRatePct: 7 },
        { kind: "expense", ref: "p1", date: "2026-10-03", category: "Rent", amountPaise: 100, account: { name: "HDFC Current" } },
        { kind: "nonsense", ref: "z" },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.results.map((r) => r.message)).toEqual([
      expect.stringMatching(/Party "Nobody Ltd" isn't in this company/),
      expect.stringMatching(/no 7% tax rate/),
      expect.stringMatching(/ref appears twice/),
      expect.stringMatching(/Invalid/),
    ]);
  });
});
