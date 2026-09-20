import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, users } from "@/db/schema";
import { ALL_PERMISSIONS, can } from "@/lib/permissions";
import { createUser, deleteRole, listRoles, listUsers, resetUserPassword, saveFirm, saveRole, updateUser } from "@/server/admin";
import { MasterError } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";
import { testDb } from "./helpers/db";

let db: DB;
let ownerId: number;
let accountantRole: number;
let staffRole: number;
let ownerRole: number;

beforeAll(async () => {
  db = await testDb();
  ownerId = await runFirstSetup(db, {
    businessName: "Al Amal Trading Est.",
    country: "SA",
    ownerName: "Owner",
    email: "owner@example.com",
    password: "Tulsi-Garden-4471",
  } as never);
  const r = await listRoles(db);
  ownerRole = r.find((x) => x.isOwner)!.id;
  accountantRole = r.find((x) => x.name === "Accountant")!.id;
  staffRole = r.find((x) => x.name === "Billing staff")!.id;
});

const fails = async (p: Promise<unknown>, part: string) => {
  await expect(p).rejects.toBeInstanceOf(MasterError);
  await expect(p).rejects.toThrow(part);
};

describe("roles and permissions", () => {
  it("seeds an owner, accountant and staff role", async () => {
    const r = await listRoles(db);
    expect(r.map((x) => x.name)).toEqual(["Owner", "Accountant", "Billing staff"]);
    expect(r[0].isOwner).toBe(true);
  });

  it("owner can do everything; others only what is ticked", async () => {
    const r = await listRoles(db);
    const owner = { isOwner: true, permissions: [] as string[] };
    const acc = { isOwner: false, permissions: r.find((x) => x.name === "Accountant")!.permissions };
    const staff = { isOwner: false, permissions: r.find((x) => x.name === "Billing staff")!.permissions };
    for (const p of ALL_PERMISSIONS) expect(can(owner, p)).toBe(true);
    expect(can(acc, "reports.all")).toBe(true);
    expect(can(acc, "users.manage")).toBe(false);
    expect(can(staff, "vouchers.create")).toBe(true);
    expect(can(staff, "see.purchasePrice")).toBe(false);
    expect(can(staff, "money.view")).toBe(false);
    expect(can(null, "vouchers.create")).toBe(false);
  });

  it("creates a custom role, dropping unknown permission keys", async () => {
    const id = await saveRole(db, { name: "Shop counter", permissions: ["vouchers.create", "see.partyBalance", "not.a.permission"] }, ownerId);
    const [role] = (await listRoles(db)).filter((x) => x.id === id);
    expect(role.permissions.sort()).toEqual(["see.partyBalance", "vouchers.create"]);
    await fails(saveRole(db, { name: "shop COUNTER", permissions: [] }, ownerId), "already exists");
  });

  it("never lets the Owner role be edited, or built-in roles deleted", async () => {
    await fails(saveRole(db, { id: ownerRole, name: "Owner", permissions: [] }, ownerId), "Owner role");
    await fails(deleteRole(db, staffRole, ownerId), "Built-in");
  });

  it("won't delete a role that still has users", async () => {
    const id = await saveRole(db, { name: "Temp role", permissions: [] }, ownerId);
    const uid = await createUser(db, { name: "Temp", email: "temp@example.com", roleId: id, password: "Blue-Lantern-2291" }, ownerId);
    await fails(deleteRole(db, id, ownerId), "still using");
    await updateUser(db, { id: uid, name: "Temp", phone: "", roleId: staffRole, active: true }, ownerId);
    await deleteRole(db, id, ownerId);
    expect((await listRoles(db)).some((r) => r.id === id)).toBe(false);
  });
});

describe("users", () => {
  it("adds a user with a temporary password they must change", async () => {
    const id = await createUser(db, { name: "Farah", email: "Farah@Example.com", roleId: accountantRole, password: "Blue-Lantern-2291" }, ownerId);
    const [u] = (await listUsers(db)).filter((x) => x.id === id);
    expect(u.email).toBe("farah@example.com");
    expect(u.mustChangePassword).toBe(true);
    expect(u.roleName).toBe("Accountant");
  });

  it("rejects weak passwords and duplicate emails", async () => {
    await fails(createUser(db, { name: "X", email: "x@example.com", roleId: staffRole, password: "short" }, ownerId), "10 characters");
    await fails(createUser(db, { name: "X", email: "FARAH@example.com", roleId: staffRole, password: "Blue-Lantern-2291" }, ownerId), "already exists");
  });

  it("protects the last active owner and the acting user", async () => {
    await fails(updateUser(db, { id: ownerId, name: "Owner", phone: "", roleId: staffRole, active: true }, ownerId), "own role");
    await fails(updateUser(db, { id: ownerId, name: "Owner", phone: "", roleId: ownerRole, active: false }, ownerId), "yourself");
    const second = await createUser(db, { name: "Second Owner", email: "second@example.com", roleId: ownerRole, password: "Blue-Lantern-2291" }, ownerId);
    // With two owners the second may step down…
    await updateUser(db, { id: second, name: "Second Owner", phone: "", roleId: staffRole, active: true }, ownerId);
    // …but nobody can remove the only remaining owner.
    const acting = await createUser(db, { name: "Manager", email: "mgr@example.com", roleId: accountantRole, password: "Blue-Lantern-2291" }, ownerId);
    await fails(updateUser(db, { id: ownerId, name: "Owner", phone: "", roleId: staffRole, active: true }, acting), "at least one active owner");
  });

  it("resets another user's password but not your own", async () => {
    const [u] = (await listUsers(db)).filter((x) => x.email === "farah@example.com");
    const before = (await db.select().from(users).where(eq(users.id, u.id)))[0].passwordHash;
    await resetUserPassword(db, u.id, "Green-Harbour-7710", ownerId);
    const after = (await db.select().from(users).where(eq(users.id, u.id)))[0];
    expect(after.passwordHash).not.toBe(before);
    expect(after.mustChangePassword).toBe(true);
    await fails(resetUserPassword(db, ownerId, "Green-Harbour-7710", ownerId), "My account");
  });
});

describe("business settings", () => {
  const base = { name: "Al Amal Trading Est." };
  it("saves an optional VAT number for a Saudi business and validates it", async () => {
    await saveFirm(db, { ...base, taxId: "300000000000003", address: "Riyadh" }, ownerId);
    const [f] = await db.select().from(firms).where(eq(firms.isDefault, true));
    expect(f.gstin).toBe("300000000000003");
    expect(f.stateCode).toBeNull();
    await fails(saveFirm(db, { ...base, taxId: "123" }, ownerId), "15");
    await saveFirm(db, base, ownerId);
    expect((await db.select().from(firms))[0].gstin).toBeNull();
  });
});

