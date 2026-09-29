import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, firms, ledgerCategories, locations, vouchers } from "@/db/schema";
import { accountSchema, saveAccount } from "@/server/masters";
import { dashboard, profitAndLoss } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { employeePayments, monthLabel, payEmployee, salaryCategoryId, salarySheet, saveEmployee, saveSalaryAdjustment, shiftMonth } from "@/server/staff";
import { cancelVoucher, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

const R = (rupees: number) => Math.round(rupees * 100);
const U = 1;
let db: DB;
let F: number;
let shop: number;
let cash: number, bank: number;
let ravi: number, meena: number;

const row = async (month: string, id: number) => (await salarySheet(db, F, month)).rows.find((r) => r.employeeId === id);

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Staff Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: F }] = await db.select({ id: firms.id }).from(firms);
  shop = (await db.select().from(locations).where(and(eq(locations.firmId, F), eq(locations.kind, "shop"))))[0].id;
  [{ id: cash }] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, F), eq(accounts.kind, "cash")));
  bank = await saveAccount(db, F, accountSchema.parse({ kind: "bank", name: "SBI Current", ifsc: "SBIN0001234", openingBalancePaise: R(100_000), openingDate: "2026-08-01" }) as never, U);
  ravi = await saveEmployee(db, F, { name: "Ravi Kumar", role: "Cashier", locationId: shop, monthlySalaryPaise: R(15_000), joinedOn: "2026-01-10" }, U);
  meena = await saveEmployee(db, F, { name: "Meena", role: "Online packing", monthlySalaryPaise: R(12_000), joinedOn: "2026-03-01" }, U);
});

describe("employees", () => {
  it("rejects a leaving date before the joining date", async () => {
    await expect(saveEmployee(db, F, { name: "X", monthlySalaryPaise: 0, joinedOn: "2026-05-01", leftOn: "2026-04-01" }, U)).rejects.toThrow(/before the joining date/);
  });

  it("only lists people employed in the month", async () => {
    const leftEarly = await saveEmployee(db, F, { name: "Left in July", monthlySalaryPaise: R(9_000), joinedOn: "2026-01-01", leftOn: "2026-07-31", active: false }, U);
    const joinsLater = await saveEmployee(db, F, { name: "Joins in October", monthlySalaryPaise: R(9_000), joinedOn: "2026-10-05" }, U);
    const ids = (await salarySheet(db, F, "2026-09")).rows.map((r) => r.employeeId);
    expect(ids).toContain(ravi);
    expect(ids).toContain(meena);
    expect(ids).not.toContain(leftEarly);
    expect(ids).not.toContain(joinsLater);
    expect((await salarySheet(db, F, "2026-10")).rows.map((r) => r.employeeId)).toContain(joinsLater);
  });
});

describe("a month of pay", () => {
  it("an advance is taken off what's still due", async () => {
    await payEmployee(db, F, { employeeId: ravi, month: "2026-09", kind: "advance", amountPaise: R(3_000), date: "2026-09-10", accountId: cash, paymentMode: "Cash" }, U);
    const r = (await row("2026-09", ravi))!;
    expect(r).toMatchObject({ earnedPaise: R(15_000), advancePaise: R(3_000), payablePaise: R(12_000), paidPaise: 0, duePaise: R(12_000) });
  });

  it("extra pay and deductions change what's earned", async () => {
    await saveSalaryAdjustment(db, F, { employeeId: meena, month: "2026-09", extraPaise: R(1_000), deductionPaise: R(500), note: "Diwali bonus; 1 day unpaid leave" }, U);
    expect(await row("2026-09", meena)).toMatchObject({ earnedPaise: R(12_500), duePaise: R(12_500), note: "Diwali bonus; 1 day unpaid leave" });
  });

  it("paying the salary clears what's due, and paying more than that is refused", async () => {
    await payEmployee(db, F, { employeeId: ravi, month: "2026-09", kind: "salary", amountPaise: R(12_000), date: "2026-09-30", accountId: bank, paymentMode: "Bank transfer" }, U);
    expect((await row("2026-09", ravi))!.duePaise).toBe(0);
    await expect(payEmployee(db, F, { employeeId: ravi, month: "2026-09", kind: "salary", amountPaise: R(1), date: "2026-09-30", accountId: bank }, U)).rejects.toThrow(/already fully paid/);
    await expect(payEmployee(db, F, { employeeId: meena, month: "2026-09", kind: "salary", amountPaise: R(13_000), date: "2026-09-30", accountId: bank }, U)).rejects.toThrow(/more than the .* still due/);
  });

  it("pays an exact amount in paise, with no rounding", async () => {
    await saveSalaryAdjustment(db, F, { employeeId: meena, month: "2026-09", extraPaise: R(1_000.5), deductionPaise: R(500), note: null }, U);
    await payEmployee(db, F, { employeeId: meena, month: "2026-09", kind: "salary", amountPaise: R(12_500.5), date: "2026-09-30", accountId: bank }, U);
    expect((await row("2026-09", meena))!.duePaise).toBe(0);
  });

  it("the sheet totals add up", async () => {
    const s = await salarySheet(db, F, "2026-09");
    const mine = s.rows.filter((r) => r.employeeId === ravi || r.employeeId === meena);
    expect(mine.reduce((a, r) => a + r.paidPaise + r.advancePaise, 0)).toBe(R(3_000 + 12_000 + 12_500.5));
    expect(s.totals.duePaise).toBe(s.rows.reduce((a, r) => a + Math.max(0, r.duePaise), 0));
  });
});

describe("it's all in the books", () => {
  it("every payment is a Salaries & wages expense, from the right account", async () => {
    const pl = await profitAndLoss(db, F, "2026-09-01", "2026-09-30");
    const salaries = pl.expenseByCategory.find((c: { name: string }) => c.name === "Salaries & wages") as { amount: number } | undefined;
    expect(salaries?.amount).toBe(R(3_000 + 12_000 + 12_500.5));
    const money = new Map((await dashboard(db, F)).money.map((m) => [m.name, m.balance]));
    expect(money.get("Cash in hand")).toBe(R(-3_000)); // the advance came out of the till
    expect(money.get("SBI Current")).toBe(R(100_000 - 12_000 - 12_500.5));
  });

  it("the expense shows the employee's name and the salary shows against their shop", async () => {
    const [v] = await db.select().from(vouchers).where(and(eq(vouchers.employeeId, ravi), eq(vouchers.payKind, "salary")));
    expect(v.partyName).toBe("Ravi Kumar");
    expect(v.locationId).toBe(shop);
  });

  it("cancelling an advance puts it back on what's due", async () => {
    const [adv] = await db.select().from(vouchers).where(and(eq(vouchers.employeeId, ravi), eq(vouchers.payKind, "advance")));
    await cancelVoucher(db, F, adv.id, U);
    expect(await row("2026-09", ravi)).toMatchObject({ advancePaise: 0, duePaise: R(3_000) });
    const history = await employeePayments(db, F, ravi);
    expect(history.map((h) => [h.payKind, h.status])).toEqual(expect.arrayContaining([["advance", "cancelled"], ["salary", "active"]]));
  });

  it("editing a salary expense on the normal Expenses screen keeps it linked to the employee", async () => {
    const [v] = await db.select().from(vouchers).where(and(eq(vouchers.employeeId, ravi), eq(vouchers.payKind, "salary")));
    await saveVoucher(db, F, { id: v.id, type: "expense", date: v.date, partyName: v.partyName, categoryId: v.categoryId, accountId: bank, paidPaise: R(12_000), notes: "paid by NEFT", lines: [{ description: "Salary", qtyMilli: 1000, ratePaise: R(12_000) }] }, U);
    const [after] = await db.select().from(vouchers).where(eq(vouchers.id, v.id));
    expect([after.employeeId, after.payMonth, after.payKind]).toEqual([ravi, "2026-09", "salary"]);
  });

  it("an employee from another company can't be linked", async () => {
    await expect(saveVoucher(db, F, { type: "expense", date: "2026-09-30", employeeId: 999_999, payMonth: "2026-09", payKind: "salary", accountId: cash, lines: [{ description: "x", qtyMilli: 1000, ratePaise: 100 }] }, U)).rejects.toThrow(/no longer exists/);
  });
});

describe("salaries stay private", () => {
  const staffUser = { isOwner: false, permissions: ["vouchers.create"], allLocations: true, locations: [], id: 99 } as never;
  const accountant = { isOwner: false, permissions: ["staff.manage"], allLocations: true, locations: [], id: 98 } as never;

  it("billing staff can't open a salary payment, but someone who manages staff can", async () => {
    const { canSeeVoucher } = await import("@/lib/auth");
    const [v] = await db.select().from(vouchers).where(eq(vouchers.employeeId, ravi));
    expect(canSeeVoucher(staffUser, v)).toBe(false);
    expect(canSeeVoucher(accountant, v)).toBe(true);
  });

  it("salary payments are left out of expense lists, the day book and search for them", async () => {
    const { dayBook, globalSearch, listVouchers } = await import("@/server/reports");
    const all = await listVouchers(db, F, { types: ["expense"] });
    const hidden = await listVouchers(db, F, { types: ["expense"], hideSalaries: true });
    expect(all.some((v) => v.party_name === "Ravi Kumar")).toBe(true);
    expect(hidden.some((v) => v.party_name === "Ravi Kumar")).toBe(false);
    const book = await dayBook(db, F, "2026-09-01", "2026-09-30", undefined, { hideSalaries: true });
    expect(book.some((v) => v.party_name === "Ravi Kumar" || v.party_name === "Meena")).toBe(false);
    const found = await globalSearch(db, F, "Ravi", { hideSalaries: true });
    expect(found.vouchers).toHaveLength(0);
    expect((await globalSearch(db, F, "Ravi")).vouchers.length).toBeGreaterThan(0);
  });
});

describe("the salary category", () => {
  it("is found after being renamed, and recreated if deleted", async () => {
    const original = await salaryCategoryId(db, F);
    await db.update(ledgerCategories).set({ name: "Staff salary" }).where(eq(ledgerCategories.id, original));
    expect(await salaryCategoryId(db, F)).toBe(original);
    await db.update(ledgerCategories).set({ name: "Something else" }).where(eq(ledgerCategories.id, original));
    const fresh = await salaryCategoryId(db, F);
    expect(fresh).not.toBe(original);
    const [c] = await db.select().from(ledgerCategories).where(eq(ledgerCategories.id, fresh));
    expect(c.name).toBe("Salaries & wages");
  });
});

describe("month helpers", () => {
  it("labels and steps months across a year end", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});
