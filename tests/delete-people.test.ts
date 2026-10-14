import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, employees, firms, partnerPayouts, partnerPromotions, partners, roles, salaryAdjustments, users } from "@/db/schema";
import { can } from "@/lib/permissions";
import { createCompany } from "@/server/admin";
import { addPromotion, deletePartner, payPartner, savePartner, savePayoutInvoice, saveViews, setPartnersEnabled } from "@/server/partners";
import { runFirstSetup } from "@/server/setup";
import { deleteEmployee, payEmployee, saveEmployee, saveSalaryAdjustment } from "@/server/staff";
import { testDb } from "./helpers/db";

let db: DB;
let F: number;
let U: number;
let cash: number;
const M = "2026-10";

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Del Co", country: "IN", stateCode: "32", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" } as never);
  [{ id: F }] = await db.select({ id: firms.id }).from(firms);
  [{ id: U }] = await db.select({ id: users.id }).from(users);
  [{ id: cash }] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, F), eq(accounts.kind, "cash")));
  await setPartnersEnabled(db, F, true, U);
});

describe("who may delete", () => {
  it("the Owner and the Company owner role, not Accountant or Billing staff", async () => {
    const all = await db.select().from(roles);
    const by = (n: string) => all.find((r) => r.name === n)!;
    expect(can({ isOwner: true, permissions: [] }, "people.delete")).toBe(true);
    expect((by("Company owner").permissions as string[]).includes("people.delete")).toBe(true);
    expect((by("Accountant").permissions as string[]).includes("people.delete")).toBe(false);
    expect((by("Billing staff").permissions as string[]).includes("people.delete")).toBe(false);
  });
});

describe("deleting staff", () => {
  it("removes someone never paid, with their month notes", async () => {
    const id = await saveEmployee(db, F, { name: "Temp", monthlySalaryPaise: 900_000 }, U);
    await saveSalaryAdjustment(db, F, { employeeId: id, month: M, extraPaise: 10_000, deductionPaise: 0 }, U);
    expect(await deleteEmployee(db, F, id, U)).toBe("deleted");
    expect(await db.select().from(employees).where(eq(employees.id, id))).toHaveLength(0);
    expect(await db.select().from(salaryAdjustments).where(eq(salaryAdjustments.employeeId, id))).toHaveLength(0);
  });

  it("makes someone with payments inactive instead, keeping their payments", async () => {
    const id = await saveEmployee(db, F, { name: "Ravi", monthlySalaryPaise: 1_500_000 }, U);
    await payEmployee(db, F, { employeeId: id, month: M, kind: "advance", amountPaise: 200_000, date: "2026-10-05", accountId: cash }, U);
    expect(await deleteEmployee(db, F, id, U)).toBe("deactivated");
    expect((await db.select().from(employees).where(eq(employees.id, id)))[0].active).toBe(false);
  });

  it("can't reach another company's staff", async () => {
    const other = await createCompany(db, { name: "Other", country: "IN", taxId: "", stateCode: "27" }, { id: U, isOwner: true, firms: [], permissions: [] });
    const id = await saveEmployee(db, other, { name: "Theirs", monthlySalaryPaise: 0 }, U);
    await expect(deleteEmployee(db, F, id, U)).rejects.toThrow(/no longer exists/);
    expect(await db.select().from(employees).where(eq(employees.id, id))).toHaveLength(1);
  });
});

describe("deleting partners", () => {
  const add = (name: string) => savePartner(db, F, { name, kind: "national", ratePerMillionPaise: 40_000 }, U);

  it("removes a partner with no payments or invoices, along with views and promotions typed in", async () => {
    const id = await add("Trial channel");
    await saveViews(db, F, { partnerId: id, month: M, views: 1_000_000 }, U);
    await addPromotion(db, F, { partnerId: id, month: M, description: "Reel", amountPaise: 50_000 }, U);
    const [payout] = await db.select().from(partnerPayouts).where(eq(partnerPayouts.partnerId, id));
    expect(await deletePartner(db, F, id, U)).toBe("deleted");
    expect(await db.select().from(partners).where(eq(partners.id, id))).toHaveLength(0);
    expect(await db.select().from(partnerPayouts).where(eq(partnerPayouts.partnerId, id))).toHaveLength(0);
    expect(await db.select().from(partnerPromotions).where(eq(partnerPromotions.payoutId, payout.id))).toHaveLength(0);
  });

  it("keeps a partner who has an invoice, as inactive", async () => {
    const id = await add("Invoiced");
    await saveViews(db, F, { partnerId: id, month: M, views: 2_000_000 }, U);
    await savePayoutInvoice(db, F, { partnerId: id, month: M, date: "2026-10-31" }, U);
    expect(await deletePartner(db, F, id, U)).toBe("deactivated");
    expect((await db.select().from(partners).where(eq(partners.id, id)))[0].active).toBe(false);
  });

  it("keeps a partner who has been paid, as inactive", async () => {
    const id = await add("Paid");
    await saveViews(db, F, { partnerId: id, month: M, views: 2_000_000 }, U);
    await payPartner(db, F, { partnerId: id, month: M, amountPaise: 80_000, date: "2026-10-31", accountId: cash }, U);
    expect(await deletePartner(db, F, id, U)).toBe("deactivated");
  });
});
