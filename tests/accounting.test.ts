import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, firms, taxRates } from "@/db/schema";
import { depreciationForYear, isBalanced, journalForVoucher } from "@/lib/gl";
import { accountLedger, balanceSheet, deleteJournal, disposeAsset, ensureAccount, listAssets, listGlAccounts, pendingDepreciationYears, postJournal, runDepreciation, saveAsset, saveGlAccount, trialBalance } from "@/server/gl";
import { saveParty } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

const base = { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0, roundOffPaise: 0, itcEligible: true, categoryId: null };

describe("journal rules", () => {
  it("a part-paid sale debits receivables and cash, and credits sales and tax", () => {
    const j = journalForVoucher({ ...base, type: "sale_invoice", taxablePaise: 10_000, cgstPaise: 450, sgstPaise: 450, roundOffPaise: 0 }, 5_900, [{ accountId: 1, amountPaise: 5_000 }]);
    expect(isBalanced(j)).toBe(true);
    expect(j).toEqual(expect.arrayContaining([{ key: "receivable", debit: 5_900, credit: 0, memo: undefined }, { key: "money:1", debit: 5_000, credit: 0, memo: undefined }, { key: "sales", debit: 0, credit: 10_000, memo: undefined }]));
    expect(j.filter((l) => l.key === "output_tax").reduce((s, l) => s + l.credit, 0)).toBe(900);
  });

  it("an expense with tax goes to input tax only when the credit is claimable", () => {
    const e = { ...base, type: "expense" as const, taxablePaise: 10_000, igstPaise: 1_800 };
    const claim = journalForVoucher(e, -11_800, []);
    expect(claim.find((l) => l.key === "input_tax")!.debit).toBe(1_800);
    expect(claim.find((l) => l.key === "expense_default")!.debit).toBe(10_000);
    const blocked = journalForVoucher({ ...e, itcEligible: false }, -11_800, []);
    expect(blocked.find((l) => l.key === "input_tax")).toBeUndefined();
    expect(blocked.find((l) => l.key === "expense_default")!.debit).toBe(11_800);
    expect(isBalanced(claim) && isBalanced(blocked)).toBe(true);
  });

  it("a transfer moves money between two accounts and nothing else", () => {
    const j = journalForVoucher({ ...base, type: "money_transfer" }, 0, [{ accountId: 1, amountPaise: -500 }, { accountId: 2, amountPaise: 500 }]);
    expect(j.map((l) => l.key).sort()).toEqual(["money:1", "money:2"]);
  });
});

describe("depreciation rules", () => {
  const sl = { costPaise: 1_200_000, salvagePaise: 0, method: "straight_line" as const, rateBp: 1000, purchaseDate: "2026-04-01", disposedOn: null };
  it("straight line: a full year is cost x rate; a part year is by days", () => {
    expect(depreciationForYear(sl, "2026-04-01", "2027-03-31", 0)).toBe(120_000);
    expect(depreciationForYear({ ...sl, purchaseDate: "2026-10-01" }, "2026-04-01", "2027-03-31", 0)).toBe(Math.round((120_000 * 182) / 365));
    expect(depreciationForYear(sl, "2025-04-01", "2026-03-31", 0)).toBe(0);
  });
  it("reducing balance takes the rate off what is left, and never goes below scrap value", () => {
    const wdv = { ...sl, method: "reducing" as const, rateBp: 2000 };
    expect(depreciationForYear(wdv, "2027-04-01", "2028-03-31", 240_000)).toBe(192_000);
    expect(depreciationForYear({ ...wdv, salvagePaise: 1_100_000 }, "2027-04-01", "2028-03-31", 0)).toBe(100_000);
  });
  it("stops in the year of sale", () => {
    expect(depreciationForYear({ ...sl, disposedOn: "2026-09-30" }, "2026-04-01", "2027-03-31", 0)).toBe(Math.round((120_000 * 183) / 365));
  });
});

describe("accounts in use", () => {
  let db: DB;
  let firmId: number;
  let cash: number;
  const asOf = "2099-12-31";
  beforeAll(async () => {
    db = await testDb();
    await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
    [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
    [{ id: cash }] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.firmId, firmId));
  });

  it("posts a balanced manual journal and refuses an unbalanced one", async () => {
    const loan = await saveGlAccount(db, firmId, { name: "Bank loan", type: "liability", grp: "Long-term liabilities" }, 1);
    const cashAcc = await ensureAccount(db, firmId, `money:${cash}`);
    await expect(postJournal(db, firmId, { date: "2026-09-01", narration: "Loan", lines: [{ accountId: cashAcc, debitPaise: 100_000, creditPaise: 0 }, { accountId: loan, debitPaise: 0, creditPaise: 90_000 }] }, 1)).rejects.toThrow(/must be equal/);
    await expect(postJournal(db, firmId, { date: "2026-09-01", lines: [{ accountId: cashAcc, debitPaise: 100_000, creditPaise: 0 }] }, 1)).rejects.toThrow(/at least two/);
    const j = await postJournal(db, firmId, { date: "2026-09-01", narration: "Loan received", lines: [{ accountId: cashAcc, debitPaise: 100_000, creditPaise: 0 }, { accountId: loan, debitPaise: 0, creditPaise: 100_000 }] }, 1);
    expect(j.number).toBe(1);
    const tb = await trialBalance(db, firmId, asOf);
    expect(tb.find((r) => r.name === "Bank loan")!.net).toBe(-100_000);
    const led = (await accountLedger(db, firmId, loan, "2026-01-01", asOf))!;
    expect(led.closingNet).toBe(-100_000);
    await deleteJournal(db, firmId, j.id, 1);
    expect((await trialBalance(db, firmId, asOf)).find((r) => r.name === "Bank loan")).toBeUndefined();
  });

  it("protects automatic accounts and keeps names unique", async () => {
    const all = await listGlAccounts(db, firmId);
    const sys = all.find((a) => a.key === `money:${cash}`)!;
    await expect(saveGlAccount(db, firmId, { id: sys.id, name: "Renamed", type: "asset" }, 1)).rejects.toThrow(/maintained automatically/);
    await expect(saveGlAccount(db, firmId, { name: "bank loan", type: "liability" }, 1).then(() => saveGlAccount(db, firmId, { name: "BANK LOAN", type: "liability" }, 1))).rejects.toThrow(/already exists/);
  });

  it("buys an asset from cash, depreciates it by year, and books a gain on sale", async () => {
    // put some cash in first
    const cashAcc = await ensureAccount(db, firmId, `money:${cash}`);
    const capital = await ensureAccount(db, firmId, "capital");
    await postJournal(db, firmId, { date: "2026-04-01", narration: "Capital", lines: [{ accountId: cashAcc, debitPaise: 5_000_000, creditPaise: 0 }, { accountId: capital, debitPaise: 0, creditPaise: 5_000_000 }] }, 1);
    const id = await saveAsset(db, firmId, { name: "Delivery van", category: "Vehicles", purchaseDate: "2026-04-01", costPaise: 1_200_000, salvagePaise: 0, method: "straight_line", rateBp: 1000, paidFromAccountId: cash }, 1);
    let tb = await trialBalance(db, firmId, asOf);
    expect(tb.find((r) => r.name === "Vehicles")!.net).toBe(1_200_000);
    expect(tb.find((r) => r.grp === "Cash and bank")!.net).toBe(3_800_000);

    const pending = await pendingDepreciationYears(db, firmId, "2027-06-01");
    expect(pending.map((y) => y.from)).toEqual(["2026-04-01", "2027-04-01"]);
    expect(await runDepreciation(db, firmId, "2026-04-01", 1)).toBe(1);
    expect(await runDepreciation(db, firmId, "2026-04-01", 1)).toBe(0); // not twice
    const [a] = await listAssets(db, firmId);
    expect(a).toMatchObject({ accumulatedPaise: 120_000, bookValuePaise: 1_080_000 });
    await expect(saveAsset(db, firmId, { id, name: "Delivery van", category: "Vehicles", purchaseDate: "2026-04-01", costPaise: 999_999, rateBp: 1000 }, 1)).rejects.toThrow(/already been posted/);

    await disposeAsset(db, firmId, id, { date: "2026-12-31", proceedsPaise: 1_100_000, accountId: cash }, 1);
    tb = await trialBalance(db, firmId, asOf);
    expect(tb.find((r) => r.name === "Vehicles")!.net).toBe(0);
    expect(tb.find((r) => r.name.startsWith("Accumulated"))!.net).toBe(0);
    expect(tb.find((r) => r.name.startsWith("Gain or loss"))!.net).toBe(-20_000);
    await expect(disposeAsset(db, firmId, id, { date: "2027-01-01", proceedsPaise: 0, accountId: null }, 1)).rejects.toThrow(/already been sold/);

    const bs = await balanceSheet(db, firmId, asOf, 0);
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity);
  });

  it("keeps expenses with input tax credit in the tax report and out of the expense total", async () => {
    const rate = (await db.select().from(taxRates).where(eq(taxRates.firmId, firmId))).find((r) => r.gstBp === 1800 && r.nature === "taxable")!;
    const sup = await saveParty(db, firmId, { name: "Landlord", kind: "supplier", stateCode: "27" }, 1);
    const claim = await saveVoucher(db, firmId, { type: "expense", date: "2026-09-05", partyId: sup, paidPaise: 0, lines: [{ description: "Rent", qtyMilli: 1000, ratePaise: 100_000, taxRateId: rate.id }] }, 1);
    const blocked = await saveVoucher(db, firmId, { type: "expense", date: "2026-09-06", partyId: sup, paidPaise: 0, itcEligible: false, lines: [{ description: "Gift", qtyMilli: 1000, ratePaise: 10_000, taxRateId: rate.id }] }, 1);
    const tb = await trialBalance(db, firmId, asOf);
    expect(tb.find((r) => r.name.startsWith("Input tax"))!.net).toBe(18_000);
    expect(tb.find((r) => r.name === "Other expenses")!.net).toBe(100_000 + 11_800);
    void claim;
    void blocked;
  });
});
