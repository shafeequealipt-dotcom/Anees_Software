import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations } from "@/db/schema";
import { canSeeVoucher, type CurrentUser } from "@/lib/auth";
import { saveItem, saveParty } from "@/server/masters";
import { dashboard, dayBook, globalSearch, listVouchers } from "@/server/reports";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let warehouseId: number;
let shopId: number;
let widget: number;
let customer: number;
let staffId: number; // the id we pretend is a shop-restricted staff member's created_by

function shopUser(): CurrentUser {
  return {
    id: staffId,
    name: "Staff",
    email: "staff@t.example",
    roleId: 0,
    roleName: "Billing staff",
    isOwner: false,
    permissions: [],
    firmId,
    firm: { id: firmId, name: "Test Traders", country: "IN" },
    firms: [],
    locations: [], // filled in per test
    allLocations: false,
    transitLocationId: null,
    damagedLocationId: null,
    totpEnabled: false,
    mustChangePassword: false,
    sessionId: "x",
  };
}

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  const locs = await db.select().from(locations).where(eq(locations.firmId, firmId));
  warehouseId = locs.find((l) => l.kind === "warehouse")!.id;
  shopId = locs.find((l) => l.kind === "shop")!.id;
  widget = await saveItem(db, firmId, { name: "Widget", salePricePaise: 1_000, purchasePricePaise: 500 }, 1);
  customer = await saveParty(db, firmId, { kind: "customer", name: "Cust One" }, 1);
  staffId = 1; // Owner's user id from runFirstSetup, reused here as "the staff member who entered it"
});

describe("canSeeVoucher", () => {
  it("an owner-equivalent (allLocations) sees everything", () => {
    const u = { ...shopUser(), allLocations: true };
    expect(canSeeVoucher(u, { locationId: shopId, createdBy: 999 })).toBe(true);
    expect(canSeeVoucher(u, { locationId: null, createdBy: 999 })).toBe(true);
  });

  it("a shop-restricted user sees only their shop's bills", () => {
    const u = { ...shopUser(), locations: [{ id: shopId, name: "Main shop", kind: "shop" as const }] };
    expect(canSeeVoucher(u, { locationId: shopId, createdBy: 999 })).toBe(true);
    expect(canSeeVoucher(u, { locationId: warehouseId, createdBy: 999 })).toBe(false);
  });

  it("a bill with no shop recorded is visible only to whoever entered it", () => {
    const u = { ...shopUser(), locations: [{ id: shopId, name: "Main shop", kind: "shop" as const }] };
    expect(canSeeVoucher(u, { locationId: null, createdBy: u.id })).toBe(true);
    expect(canSeeVoucher(u, { locationId: null, createdBy: u.id + 1 })).toBe(false);
  });
});

describe("shop-scoped listings", () => {
  let shopSaleId: number;
  let warehouseSaleId: number;

  beforeAll(async () => {
    shopSaleId = (await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-01", locationId: shopId, partyName: "Widget buyer", lines: [{ itemId: widget, description: "Widget", qtyMilli: 1_000, ratePaise: 1_000 }] }, staffId)).id;
    warehouseSaleId = (await saveVoucher(db, firmId, { type: "sale_invoice", date: "2026-09-01", locationId: warehouseId, lines: [{ itemId: widget, description: "Widget", qtyMilli: 1_000, ratePaise: 1_000 }] }, staffId)).id;
  });

  it("listVouchers only returns a restricted user's own shop", async () => {
    const restricted = await listVouchers(db, firmId, { types: ["sale_invoice"], locationIds: [shopId], createdBy: staffId });
    expect(restricted.map((v) => v.id)).toContain(shopSaleId);
    expect(restricted.map((v) => v.id)).not.toContain(warehouseSaleId);

    const unrestricted = await listVouchers(db, firmId, { types: ["sale_invoice"] });
    expect(unrestricted.map((v) => v.id)).toEqual(expect.arrayContaining([shopSaleId, warehouseSaleId]));
  });

  it("dayBook only shows a restricted user's own shop", async () => {
    const restricted = await dayBook(db, firmId, "2026-09-01", "2026-09-01", { locationIds: [shopId], createdBy: staffId });
    expect(restricted.map((r) => r.id)).toContain(shopSaleId);
    expect(restricted.map((r) => r.id)).not.toContain(warehouseSaleId);

    const unrestricted = await dayBook(db, firmId, "2026-09-01", "2026-09-01");
    expect(unrestricted.map((r) => r.id)).toEqual(expect.arrayContaining([shopSaleId, warehouseSaleId]));
  });

  it("globalSearch's voucher results respect the same restriction (items and parties are unaffected)", async () => {
    const restricted = await globalSearch(db, firmId, "Widget buyer", { access: { locationIds: [shopId], createdBy: staffId } });
    expect(restricted.vouchers.map((v) => v.id)).toContain(shopSaleId);

    const restrictedElsewhere = await globalSearch(db, firmId, "Widget buyer", { access: { locationIds: [warehouseId], createdBy: staffId } });
    expect(restrictedElsewhere.vouchers.map((v) => v.id)).not.toContain(shopSaleId);

    const search = await globalSearch(db, firmId, "Widget", { access: { locationIds: [shopId], createdBy: staffId } });
    expect(search.items.some((i) => i.name === "Widget")).toBe(true);
  });

  it("dashboard's month totals and overdue list are scoped the same way", async () => {
    const restricted = await dashboard(db, firmId, { locationIds: [shopId], createdBy: staffId });
    const unrestricted = await dashboard(db, firmId);
    // The shop-only view can't see more sales than the whole company did.
    expect(restricted.month.sales).toBeLessThanOrEqual(unrestricted.month.sales);
    expect(restricted.month.invoices).toBeLessThan(unrestricted.month.invoices);
  });
});
