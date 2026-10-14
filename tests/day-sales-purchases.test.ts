import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, firms, locations, users } from "@/db/schema";
import { resolvePeriod } from "@/lib/periods";
import { todayIST } from "@/lib/dates";
import { saveLocation } from "@/server/locations";
import { saveItem, saveParty } from "@/server/masters";
import { daySalesPurchases } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { cancelVoucher, saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let F: number;
let U: number;
let shopA: number;
let shopB: number;
let cash: number;
const DAY = "2026-10-14";

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Two Shops", country: "IN", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" } as never);
  [{ id: F }] = await db.select({ id: firms.id }).from(firms);
  [{ id: U }] = await db.select({ id: users.id }).from(users);
  const shop = (await db.select().from(locations).where(and(eq(locations.firmId, F), eq(locations.kind, "shop"))))[0];
  shopA = await saveLocation(db, F, { id: shop.id, name: "Shop A", kind: "shop" });
  shopB = await saveLocation(db, F, { name: "Shop B", kind: "shop" });
  [{ id: cash }] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, F), eq(accounts.kind, "cash")));

  const pen = await saveItem(db, F, { name: "Pen", salePricePaise: 1_000, purchasePricePaise: 600 }, U);
  const cust = await saveParty(db, F, { name: "Ravi", kind: "customer" }, U);
  const supp = await saveParty(db, F, { name: "Paper Mills", kind: "supplier" }, U);
  const line = (rate: number, qty = 1000) => [{ itemId: pen, description: "Pen", qtyMilli: qty, ratePaise: rate }];
  const sale = (date: string, loc: number, rate: number, paid: number, party?: number) =>
    saveVoucher(db, F, { type: "sale_invoice", date, locationId: loc, partyId: party ?? null, paidPaise: paid, accountId: cash, roundOff: false, lines: line(rate) }, U);

  await sale(DAY, shopA, 10_000, 10_000); // cash sale at A
  await sale(DAY, shopA, 5_000, 0, cust); // credit sale at A
  await sale(DAY, shopB, 20_000, 20_000); // sale at B
  const gone = await sale(DAY, shopB, 99_900, 99_900); // cancelled below
  await cancelVoucher(db, F, gone.id, U);
  await sale("2026-10-13", shopA, 7_000, 7_000); // the day before
  await saveVoucher(db, F, { type: "credit_note", date: DAY, locationId: shopA, partyId: cust, paidPaise: 0, roundOff: false, lines: line(1_000) }, U);
  await saveVoucher(db, F, { type: "purchase_bill", date: DAY, locationId: shopA, partyId: supp, supplierInvoiceNo: "PM-77", paidPaise: 30_000, accountId: cash, roundOff: false, lines: line(60_000, 1000) }, U);
});

describe("sales & purchases for the day", () => {
  it("lists every bill of the day across all shops, with totals that leave out cancelled bills", async () => {
    const r = await daySalesPurchases(db, F, DAY, {});
    expect(r.sales.bills).toHaveLength(4);
    // Ravi owed ₹50; the ₹10 return was set against it, so ₹40 is still due.
    expect(r.sales).toMatchObject({ count: 3, totalPaise: 35_000, paidPaise: 31_000, duePaise: 4_000 });
    expect(r.saleReturns).toMatchObject({ count: 1, totalPaise: 1_000 });
    expect(r.netSalesPaise).toBe(34_000);
    expect(r.purchases).toMatchObject({ count: 1, totalPaise: 60_000, paidPaise: 30_000, duePaise: 30_000 });
    expect(r.purchases.bills[0].supplier_invoice_no).toBe("PM-77");
    expect(r.netPurchasesPaise).toBe(60_000);
    expect(r.sales.bills.find((b) => b.status === "cancelled")?.total_paise).toBe(99_900);
  });

  it("someone tied to one shop sees only that shop's bills", async () => {
    const a = await daySalesPurchases(db, F, DAY, { locationIds: [shopA], createdBy: 999 });
    expect(a.sales).toMatchObject({ count: 2, totalPaise: 15_000 });
    expect(a.purchases.count).toBe(1);
    const b = await daySalesPurchases(db, F, DAY, { locationIds: [shopB], createdBy: 999 });
    expect(b.sales).toMatchObject({ count: 1, totalPaise: 20_000 });
    expect(b.purchases.count).toBe(0);
    expect(b.saleReturns.count).toBe(0);
  });

  it("another day shows that day only", async () => {
    const r = await daySalesPurchases(db, F, "2026-10-13", {});
    expect(r.sales).toMatchObject({ count: 1, totalPaise: 7_000 });
    expect(r.purchases.count).toBe(0);
  });

  it("the bill lists can open on today", () => {
    const today = todayIST();
    expect(resolvePeriod({}, "today")).toMatchObject({ from: today, to: today });
    expect(resolvePeriod({ from: "2026-10-01", to: "2026-10-05" }, "today")).toMatchObject({ from: "2026-10-01", to: "2026-10-05" });
  });
});
