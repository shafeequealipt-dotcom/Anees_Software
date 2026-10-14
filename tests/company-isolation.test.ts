/**
 * A person with access to one company must never see or change anything belonging to another:
 * not its name, shops, people, or settings. Only the Owner role works across companies.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, locations, roles } from "@/db/schema";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { type Actor, createCompany, createUser, deleteRole, listAllLocations, listCompanies, listRoles, listUsers, resetUserPassword, saveRole, setCompanyActive, updateUser } from "@/server/admin";
import { runFirstSetup } from "@/server/setup";
import { testDb } from "./helpers/db";

const PW = "Blue-Lantern-2291";
let db: DB;
let ownerId: number;
let A: number, B: number;
let shopA: number, shopB: number;
let staffRole: number, ownerRole: number, companyOwnerRole: number;
let asha: Actor; // Company owner of A only
let owner: Actor;
let bClerk: number, sharedClerk: number;

beforeAll(async () => {
  db = await testDb();
  ownerId = await runFirstSetup(db, { businessName: "Anees Shop", stateCode: "27", ownerName: "Owner", email: "owner@x.example", password: PW });
  owner = { id: ownerId, isOwner: true, firms: [], permissions: [] };
  [{ id: A }] = await db.select({ id: firms.id }).from(firms);
  B = await createCompany(db, { name: "Other Co", country: "IN", stateCode: "27" }, owner);
  shopA = (await db.select().from(locations).where(and(eq(locations.firmId, A), eq(locations.kind, "shop"))))[0].id;
  shopB = (await db.select().from(locations).where(and(eq(locations.firmId, B), eq(locations.kind, "shop"))))[0].id;
  const all = await listRoles(db, owner);
  staffRole = all.find((r) => r.name === "Billing staff")!.id;
  ownerRole = all.find((r) => r.isOwner)!.id;
  companyOwnerRole = all.find((r) => r.name === "Company owner")!.id;

  const ashaId = await createUser(db, { name: "Asha", email: "asha@x.example", roleId: companyOwnerRole, password: PW, firmIds: [A] }, owner);
  asha = { id: ashaId, isOwner: false, firms: [{ id: A }], permissions: all.find((r) => r.name === "Company owner")!.permissions as string[] };
  bClerk = await createUser(db, { name: "B Clerk", email: "bclerk@x.example", roleId: staffRole, password: PW, firmIds: [B] }, owner);
  sharedClerk = await createUser(db, { name: "Shared Clerk", email: "shared@x.example", roleId: staffRole, password: PW, firmIds: [A, B] }, owner);
});

describe("the Company owner role", () => {
  it("exists, can manage its own company's people and settings, but can't add companies", async () => {
    const [r] = await db.select().from(roles).where(eq(roles.id, companyOwnerRole));
    expect(r.isOwner).toBe(false);
    expect(r.permissions).toContain("users.manage");
    expect(r.permissions).toContain("settings.edit");
    expect(r.permissions).not.toContain("companies.manage");
    // Every permission it lists is a real one (a rename would silently drop it otherwise).
    for (const k of r.permissions as string[]) expect(ALL_PERMISSIONS).toContain(k);
  });
});

describe("what a company owner can see", () => {
  it("only their own company", async () => {
    expect((await listCompanies(db, asha)).map((c) => c.id)).toEqual([A]);
    expect((await listCompanies(db, owner)).map((c) => c.id).sort()).toEqual([A, B].sort());
  });

  it("only their own company's shops and warehouse", async () => {
    const shops = await listAllLocations(db, asha);
    expect(shops.every((l) => l.firmId === A)).toBe(true);
    expect(shops.some((l) => l.id === shopA)).toBe(true);
    expect(shops.some((l) => l.id === shopB)).toBe(false);
  });

  it("only people who work solely in their company: not the owner, not another company's staff, not someone shared with another company", async () => {
    const seen = (await listUsers(db, asha)).map((u) => u.id);
    expect(seen).toContain(asha.id);
    expect(seen).not.toContain(ownerId);
    expect(seen).not.toContain(bClerk);
    expect(seen).not.toContain(sharedClerk);
  });

  it("can't pick the Owner role for anyone", async () => {
    expect((await listRoles(db, asha)).some((r) => r.isOwner)).toBe(false);
  });
});

describe("what a company owner can't do", () => {
  it("give anyone access to another company, or make an owner", async () => {
    await expect(createUser(db, { name: "X", email: "x1@x.example", roleId: staffRole, password: PW, firmIds: [B] }, asha)).rejects.toThrow(/companies you can open/);
    await expect(createUser(db, { name: "X", email: "x2@x.example", roleId: ownerRole, password: PW, firmIds: [A] }, asha)).rejects.toThrow(/Only an owner/);
  });

  it("give a role that can do more than they can (e.g. add companies), or even see it in the list", async () => {
    const powerful = await saveRole(db, { name: "Company maker", permissions: ["companies.manage", "vouchers.create"] }, owner);
    expect((await listRoles(db, asha)).some((r) => r.id === powerful)).toBe(false);
    await expect(createUser(db, { name: "X", email: "x5@x.example", roleId: powerful, password: PW, firmIds: [A] }, asha)).rejects.toThrow(/only an owner can give it/);
  });

  it("assign another company's shop", async () => {
    await expect(createUser(db, { name: "X", email: "x3@x.example", roleId: staffRole, password: PW, firmIds: [A], locationIds: [shopB] }, asha)).rejects.toThrow(/doesn't belong/);
  });

  it("change or reset the password of someone outside their company", async () => {
    await expect(updateUser(db, { id: bClerk, name: "B Clerk", phone: "", roleId: staffRole, active: false, firmIds: [A] }, asha)).rejects.toThrow(/don't have access/);
    await expect(updateUser(db, { id: sharedClerk, name: "Shared", phone: "", roleId: staffRole, active: false, firmIds: [A] }, asha)).rejects.toThrow(/don't have access/);
    await expect(resetUserPassword(db, ownerId, "Green-Harbour-7710", asha)).rejects.toThrow(/don't have access/);
  });

  it("change built-in or shared roles, or hide another company", async () => {
    await expect(saveRole(db, { id: staffRole, name: "Billing staff", permissions: [] }, asha)).rejects.toThrow(/only an owner can change them/);
    await expect(deleteRole(db, staffRole, asha)).rejects.toThrow(/Built-in/);
    const shared = await saveRole(db, { name: "Shared helper", permissions: ["vouchers.create"] }, owner);
    await expect(saveRole(db, { id: shared, name: "Shared helper", permissions: [] }, asha)).rejects.toThrow(/only an owner can change them/);
    await expect(deleteRole(db, shared, asha)).rejects.toThrow(/only an owner can change them/);
    await expect(setCompanyActive(db, B, false, asha)).rejects.toThrow(/no longer exists/);
  });
});

describe("roles belonging to one company", () => {
  let aRole: number;
  let bRole: number;

  it("a company owner makes roles for their own company only, and can't give more than they have", async () => {
    aRole = await saveRole(db, { name: "Counter", permissions: ["vouchers.create", "reports.sales"] }, asha);
    const [r] = await db.select().from(roles).where(eq(roles.id, aRole));
    expect(r.firmId).toBe(A); // their only company, picked for them
    await expect(saveRole(db, { name: "Elsewhere", permissions: [], firmId: B }, asha)).rejects.toThrow(/companies you can open/);
    await expect(saveRole(db, { name: "Too much", permissions: ["companies.manage"] }, asha)).rejects.toThrow(/aren't allowed to do yourself/);
    await saveRole(db, { id: aRole, name: "Counter staff", permissions: ["vouchers.create"] }, asha);
    expect((await db.select().from(roles).where(eq(roles.id, aRole)))[0].name).toBe("Counter staff");
  });

  it("another company's roles are invisible and untouchable", async () => {
    bRole = await saveRole(db, { name: "B only", permissions: ["vouchers.create"], firmId: B }, owner);
    const seen = (await listRoles(db, asha)).map((r) => r.id);
    expect(seen).toContain(aRole);
    expect(seen).toContain(staffRole);
    expect(seen).not.toContain(bRole);
    await expect(saveRole(db, { id: bRole, name: "Taken over", permissions: [] }, asha)).rejects.toThrow(/no longer exists/);
    await deleteRole(db, bRole, asha); // quietly nothing
    expect(await db.select().from(roles).where(eq(roles.id, bRole))).toHaveLength(1);
    await expect(createUser(db, { name: "X", email: "x6@x.example", roleId: bRole, password: PW, firmIds: [A] }, asha)).rejects.toThrow();
  });

  it("the owner sees every role with its company", async () => {
    const all = await listRoles(db, owner);
    expect(all.find((r) => r.id === aRole)?.firmName).toBeTruthy();
    expect(all.find((r) => r.id === bRole)?.firmId).toBe(B);
    expect(all.find((r) => r.id === staffRole)?.firmId).toBeNull();
  });

  it("a company's role only goes to people of that company, even from the owner", async () => {
    await expect(createUser(db, { name: "X", email: "x7@x.example", roleId: bRole, password: PW, firmIds: [A] }, owner)).rejects.toThrow(/belongs to a company/);
    const ok = await createUser(db, { name: "B person", email: "x8@x.example", roleId: bRole, password: PW, firmIds: [B] }, owner);
    expect(ok).toBeGreaterThan(0);
  });

  it("the same name can be used by two companies, but not clash with a shared role", async () => {
    const again = await saveRole(db, { name: "Counter staff", permissions: [], firmId: B }, owner);
    expect(again).toBeGreaterThan(0);
    await expect(saveRole(db, { name: "billing STAFF", permissions: [] }, asha)).rejects.toThrow(/already exists/);
  });

  it("a company owner adds a person with their company's role", async () => {
    const id = await createUser(db, { name: "Counter one", email: "c1@x.example", roleId: aRole, password: PW, firmIds: [A], locationIds: [shopA] }, asha);
    expect((await listUsers(db, asha)).some((u) => u.id === id && u.roleId === aRole)).toBe(true);
    expect((await listRoles(db, asha)).find((r) => r.id === aRole)?.userCount).toBe(1);
    await expect(deleteRole(db, aRole, asha)).rejects.toThrow(/still using/);
  });
});

describe("what a company owner can do", () => {
  it("add and manage staff in their own company, with their own shops", async () => {
    const id = await createUser(db, { name: "A Cashier", email: "acash@x.example", roleId: staffRole, password: PW, firmIds: [A], locationIds: [shopA] }, asha);
    expect((await listUsers(db, asha)).find((u) => u.id === id)?.locationIds).toEqual([shopA]);
    await updateUser(db, { id, name: "A Cashier", phone: "", roleId: staffRole, active: false, firmIds: [A], locationIds: [shopA] }, asha);
    await resetUserPassword(db, id, "Green-Harbour-7710", asha);
  });
});

describe("statements refuse another company's records", () => {
  it("party, item and account statements check the record belongs to the company asked for", async () => {
    const { saveParty, saveItem, saveAccount, accountSchema } = await import("@/server/masters");
    const { partyStatement, itemMovements, accountStatement } = await import("@/server/reports");
    const partyB = await saveParty(db, B, { name: "B Customer", kind: "customer" }, ownerId);
    const itemB = await saveItem(db, B, { name: "B Item", salePricePaise: 100 }, ownerId);
    const bankB = await saveAccount(db, B, accountSchema.parse({ kind: "bank", name: "B Bank", ifsc: "SBIN0001234" }) as never, ownerId);
    await expect(partyStatement(db, A, partyB, "2026-01-01", "2026-12-31")).rejects.toThrow(/isn't in this company/);
    await expect(itemMovements(db, A, itemB, "2026-01-01", "2026-12-31")).rejects.toThrow(/isn't in this company/);
    await expect(accountStatement(db, A, bankB, "2026-01-01", "2026-12-31")).rejects.toThrow(/isn't in this company/);
    await expect(accountStatement(db, B, bankB, "2026-01-01", "2026-12-31")).resolves.toBeDefined();
  });
});

describe("even an owner", () => {
  it("can't give someone a shop from a company they can't open", async () => {
    await expect(createUser(db, { name: "X", email: "x4@x.example", roleId: staffRole, password: PW, firmIds: [A], locationIds: [shopB] }, owner)).rejects.toThrow(/doesn't belong/);
  });
});
