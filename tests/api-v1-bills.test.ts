import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, users, vouchers } from "@/db/schema";
import { gstinCheckDigit } from "@/lib/gst/gstin";
import { setRegion } from "@/lib/region";
import { createCompany } from "@/server/admin";
import { ensureApiUser, setApiEnabled } from "@/server/api-keys";
import { runBatch } from "@/server/api-v1";
import { apiBills } from "@/server/api-v1-bills";
import { MasterError } from "@/server/errors";
import { runFirstSetup } from "@/server/setup";
import { testDb } from "./helpers/db";

let db: DB;
let F: number;
let other: number;
let API: number;
const GSTIN = "29ABCDE1234F1Z" + gstinCheckDigit("29ABCDE1234F1Z");

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "DNH Test", country: "IN", stateCode: "29", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" } as never);
  setRegion("IN");
  [{ id: F }] = await db.select({ id: firms.id }).from(firms);
  const [{ id: U }] = await db.select({ id: users.id }).from(users);
  other = await createCompany(db, { name: "Other Co", country: "IN", taxId: "", stateCode: "27" }, { id: U, isOwner: true, firms: [], permissions: [] });
  await setApiEnabled(db, F, true, U);
  API = await ensureApiUser(db);
  const out = await runBatch(db, { firmId: F, userId: API, keyName: "Test key" }, {
    dryRun: false,
    entries: [
      { kind: "party", ref: "sup", name: "Medi Distributors", partyKind: "supplier", gstin: GSTIN },
      { kind: "item", ref: "gloves", name: "Nitrile gloves (100)", hsn: "40151900", unit: "BOX", gstRatePct: 18, purchasePricePaise: 400_00 },
      { kind: "purchase_bill", ref: "bill-1", date: "2026-09-03", party: { ref: "sup" }, billNo: "MD/881", lines: [{ item: { ref: "gloves" }, qty: 2.5, ratePaise: 400_00, gstRatePct: 18 }], expectedTotalPaise: 1_180_00 },
      { kind: "purchase_bill", ref: "bill-2", date: "2026-10-05", party: { ref: "sup" }, billNo: "MD/902", lines: [{ item: { ref: "gloves" }, qty: 1, ratePaise: 400_00, gstRatePct: 18 }], paidFrom: { name: "Cash in hand" } },
      { kind: "expense", ref: "exp-1", date: "2026-09-30", category: "Bank charges", amountPaise: 118_00, account: { name: "Cash in hand" } },
    ],
  });
  expect(out.ok).toBe(true);
});

describe("GET /api/v1/bills", () => {
  it("lists purchase bills with totals, tax, lines and what is still owed", async () => {
    const out = await apiBills(db, F, {});
    expect(out.total).toBe(2);
    const [b1, b2] = out.bills;
    expect(b1).toMatchObject({ type: "purchase_bill", date: "2026-09-03", billNo: "MD/881", party: { name: "Medi Distributors", gstin: GSTIN }, taxablePaise: 1_000_00, totalPaise: 1_180_00, paidPaise: 0, balancePaise: 1_180_00, enteredVia: "api", ref: "bill-1" });
    expect(b1.cgstPaise + b1.sgstPaise).toBe(180_00);
    expect(b1.lines).toHaveLength(1);
    expect(b1.lines![0]).toMatchObject({ qty: 2.5, ratePaise: 400_00, gstPct: 18, totalPaise: 1_180_00, item: { name: "Nitrile gloves (100)" } });
    expect(b2).toMatchObject({ billNo: "MD/902", totalPaise: 472_00, paidPaise: 472_00, balancePaise: 0, account: "Cash in hand" });
  });

  it("filters by type and date, pages, and can leave the lines out", async () => {
    const both = await apiBills(db, F, { type: "purchase_bill,expense", from: "2026-09-01", to: "2026-09-30", lines: "0" });
    expect(both.bills.map((b) => b.type).sort()).toEqual(["expense", "purchase_bill"]);
    expect(both.bills[0]).not.toHaveProperty("lines");
    const page = await apiBills(db, F, { limit: "1", offset: "1" });
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(page.bills.map((b) => b.billNo)).toEqual(["MD/902"]);
  });

  it("hides deleted bills unless status=all", async () => {
    const [v] = await db.select({ id: vouchers.id }).from(vouchers).where(and(eq(vouchers.firmId, F), eq(vouchers.externalRef, "bill-2")));
    await db.update(vouchers).set({ status: "deleted" }).where(eq(vouchers.id, v.id));
    expect((await apiBills(db, F, {})).total).toBe(1);
    expect((await apiBills(db, F, { status: "all" })).total).toBe(2);
    await db.update(vouchers).set({ status: "active" }).where(eq(vouchers.id, v.id));
  });

  it("only ever shows the key's own company", async () => {
    expect((await apiBills(db, other, {})).total).toBe(0);
  });

  it("refuses bad parameters with a plain message", async () => {
    await expect(apiBills(db, F, { type: "nonsense" })).rejects.toThrow(MasterError);
    await expect(apiBills(db, F, { from: "3/9/2026" })).rejects.toThrow("Dates look like");
    await expect(apiBills(db, F, { from: "2026-10-01", to: "2026-09-01" })).rejects.toThrow("on or before");
    await expect(apiBills(db, F, { limit: "5000" })).rejects.toThrow(MasterError);
  });
});
