import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { firms, roles, sessions, userFirms, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/auth";
import { checkGstin } from "@/lib/gst/gstin";
import { isValidStateCode } from "@/lib/gst/states";
import { checkTrn } from "@/lib/gst/trn";
import { isPermission } from "@/lib/permissions";
import { region } from "@/lib/region";
import { MasterError } from "./masters";
import { companySchema, insertCompany } from "./setup";

// ─── Roles ───────────────────────────────────────────────────────────────────

export async function listRoles(db: DB) {
  return db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      permissions: roles.permissions,
      isOwner: roles.isOwner,
      isSystem: roles.isSystem,
      userCount: sql<number>`(select count(*)::int from users u where u.role_id = "roles"."id")`,
    })
    .from(roles)
    .orderBy(sql`${roles.isOwner} desc`, asc(roles.id));
}

export const roleSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Enter a name for the role.").max(60),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  permissions: z.array(z.string()),
});

export async function saveRole(db: DB, raw: z.input<typeof roleSchema>, actorId: number) {
  const p = roleSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const { id, name, description } = p.data;
  const permissions = [...new Set(p.data.permissions.filter(isPermission))];
  const [same] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(sql`lower(${roles.name}) = ${name.toLowerCase()}`, id ? ne(roles.id, id) : sql`true`));
  if (same) throw new MasterError("A role with this name already exists.", "name");

  if (id) {
    const [old] = await db.select().from(roles).where(eq(roles.id, id));
    if (!old) throw new MasterError("That role no longer exists.");
    if (old.isOwner) throw new MasterError("The Owner role always has full access and cannot be changed.");
    await db.update(roles).set({ name, description, permissions }).where(eq(roles.id, id));
    await audit(db, { userId: actorId, action: "settings", entity: "role", entityId: id, summary: `Changed role "${name}"`, before: { name: old.name, permissions: old.permissions }, after: { name, permissions } });
    return id;
  }
  const [row] = await db.insert(roles).values({ name, description, permissions }).returning({ id: roles.id });
  await audit(db, { userId: actorId, action: "create", entity: "role", entityId: row.id, summary: `Added role "${name}"`, after: { name, permissions } });
  return row.id;
}

export async function deleteRole(db: DB, id: number, actorId: number) {
  const [role] = await db.select().from(roles).where(eq(roles.id, id));
  if (!role) return;
  if (role.isSystem) throw new MasterError("Built-in roles cannot be deleted.");
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.roleId, id));
  if (n.n > 0) throw new MasterError(`${n.n} user${n.n === 1 ? " is" : "s are"} still using this role. Move them to another role first.`);
  await db.delete(roles).where(eq(roles.id, id));
  await audit(db, { userId: actorId, action: "delete", entity: "role", entityId: id, summary: `Deleted role "${role.name}"` });
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function listUsers(db: DB) {
  const access = await db.select().from(userFirms);
  const list = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      active: users.active,
      roleId: users.roleId,
      roleName: roles.name,
      isOwner: roles.isOwner,
      mustChangePassword: users.mustChangePassword,
      totpEnabled: users.totpEnabled,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .orderBy(sql`${roles.isOwner} desc`, sql`lower(${users.name})`);
  return list.map((u) => ({ ...u, firmIds: access.filter((a) => a.userId === u.id).map((a) => a.firmId) }));
}

/** Replace the list of companies a user may open. Owners always see every company, so nothing is stored for them. */
async function setUserFirms(db: DB, userId: number, roleIsOwner: boolean, firmIds: number[]) {
  const ids = [...new Set(firmIds)];
  if (!roleIsOwner) {
    if (ids.length === 0) throw new MasterError("Choose at least one company this person can open.", "firmIds");
    const found = await db.select({ id: firms.id }).from(firms).where(inArray(firms.id, ids));
    if (found.length !== ids.length) throw new MasterError("One of the chosen companies no longer exists.", "firmIds");
  }
  await db.delete(userFirms).where(eq(userFirms.userId, userId));
  if (!roleIsOwner) await db.insert(userFirms).values(ids.map((firmId) => ({ userId, firmId })));
}

const userFields = {
  firmIds: z.array(z.number().int().positive()).default([]),
  name: z.string().trim().min(1, "Enter the person's name.").max(120),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  roleId: z.number().int().positive("Choose a role."),
};

export const newUserSchema = z.object({
  ...userFields,
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().max(200),
});

export const editUserSchema = z.object({ id: z.number().int().positive(), ...userFields, active: z.boolean() });

async function activeOwnerCount(db: DB, exceptUserId?: number) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(roles.isOwner, true), eq(users.active, true), exceptUserId ? ne(users.id, exceptUserId) : sql`true`));
  return r.n;
}

export async function createUser(db: DB, raw: z.input<typeof newUserSchema>, actorId: number) {
  const p = newUserSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const weak = passwordProblem(i.password);
  if (weak) throw new MasterError(weak, "password");
  const [role] = await db.select({ id: roles.id, isOwner: roles.isOwner }).from(roles).where(eq(roles.id, i.roleId));
  if (!role) throw new MasterError("Choose a role.", "roleId");
  if (!role.isOwner && i.firmIds.length === 0) throw new MasterError("Choose at least one company this person can open.", "firmIds");
  const [dup] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${i.email}`);
  if (dup) throw new MasterError("Someone with this email already exists.", "email");
  const [row] = await db
    .insert(users)
    .values({ name: i.name, email: i.email, phone: i.phone, roleId: i.roleId, passwordHash: await hashPassword(i.password), mustChangePassword: true })
    .returning({ id: users.id });
  await setUserFirms(db, row.id, role.isOwner, i.firmIds);
  await audit(db, { userId: actorId, action: "create", entity: "user", entityId: row.id, summary: `Added user ${i.name} (${i.email})` });
  return row.id;
}

export async function updateUser(db: DB, raw: z.input<typeof editUserSchema>, actorId: number) {
  const p = editUserSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const [cur] = await db.select({ u: users, isOwner: roles.isOwner }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, i.id));
  if (!cur) throw new MasterError("That user no longer exists.");
  const [role] = await db.select().from(roles).where(eq(roles.id, i.roleId));
  if (!role) throw new MasterError("Choose a role.", "roleId");

  if (i.id === actorId && (!i.active || i.roleId !== cur.u.roleId)) {
    throw new MasterError("You can't deactivate yourself or change your own role. Ask another owner.");
  }
  const staysActiveOwner = role.isOwner && i.active;
  if (cur.isOwner && cur.u.active && !staysActiveOwner && (await activeOwnerCount(db, i.id)) === 0) {
    throw new MasterError("There must always be at least one active owner.");
  }
  await setUserFirms(db, i.id, role.isOwner, i.firmIds);
  await db.update(users).set({ name: i.name, phone: i.phone, roleId: i.roleId, active: i.active, updatedAt: new Date() }).where(eq(users.id, i.id));
  if (!i.active) await db.delete(sessions).where(eq(sessions.userId, i.id));
  await audit(db, {
    userId: actorId,
    action: "update",
    entity: "user",
    entityId: i.id,
    summary: `Changed user ${i.name}${cur.u.active !== i.active ? (i.active ? " (re-activated)" : " (deactivated)") : ""}`,
    before: { roleId: cur.u.roleId, active: cur.u.active },
    after: { roleId: i.roleId, active: i.active },
  });
}

export async function resetUserPassword(db: DB, id: number, password: string, actorId: number) {
  if (id === actorId) throw new MasterError("Change your own password from My account instead.");
  const weak = passwordProblem(password);
  if (weak) throw new MasterError(weak, "password");
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id));
  if (!u) throw new MasterError("That user no longer exists.");
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id));
  await audit(db, { userId: actorId, action: "update", entity: "user", entityId: id, summary: `Reset password for ${u.name}` });
}

// ─── Business details ────────────────────────────────────────────────────────

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const firmSchema = z.object({
  name: z.string().trim().min(1, "Enter your business name.").max(200),
  legalName: optText(200),
  taxId: z.string().trim().max(15).optional().transform((v) => (v ? v.toUpperCase() : null)),
  gstScheme: z.enum(["regular", "composition", "unregistered"]).default("regular"),
  stateCode: z.string().optional().transform((v) => v || null),
  address: optText(1000),
  city: optText(100),
  pincode: optText(10),
  phone: optText(30),
  email: z.string().trim().max(200).optional().transform((v) => v || null),
  website: optText(200),
  bankName: optText(120),
  bankAccountNo: optText(40),
  bankIfsc: optText(15),
  bankBranch: optText(120),
  upiId: optText(100),
  invoiceTerms: optText(2000),
});

export async function saveFirm(db: DB, firmId: number, raw: z.input<typeof firmSchema>, actorId: number) {
  const p = firmSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const [current] = await db.select({ country: firms.country }).from(firms).where(eq(firms.id, firmId));
  if (!current) throw new MasterError("This company no longer exists.");
  const r = region();
  let stateCode: string | null = r.usesStates ? i.stateCode : null;
  if (i.taxId) {
    const t = r.country === "SA" ? checkTrn(i.taxId) : checkGstin(i.taxId);
    if (!t.ok) throw new MasterError(t.reason, "taxId");
    const fromGstin = (t as { stateCode?: string }).stateCode;
    if (fromGstin) {
      if (stateCode && fromGstin !== stateCode) throw new MasterError("The GSTIN's state doesn't match the state you chose.", "stateCode");
      stateCode ||= fromGstin;
    }
  }
  if (stateCode && !isValidStateCode(stateCode)) throw new MasterError("Choose a valid state.", "stateCode");
  if (i.email && !z.string().email().safeParse(i.email).success) throw new MasterError("Enter a valid email address.", "email");
  await db
    .update(firms)
    .set({
      name: i.name,
      legalName: i.legalName,
      gstin: i.taxId,
      pan: r.country === "IN" && i.taxId ? i.taxId.slice(2, 12) : null,
      gstScheme: i.taxId ? i.gstScheme : "unregistered",
      stateCode,
      address: i.address,
      city: i.city,
      pincode: i.pincode,
      phone: i.phone,
      email: i.email,
      website: i.website,
      bankName: i.bankName,
      bankAccountNo: i.bankAccountNo,
      bankIfsc: i.bankIfsc,
      bankBranch: i.bankBranch,
      upiId: i.upiId,
      invoiceTerms: i.invoiceTerms,
      updatedAt: new Date(),
    })
    .where(eq(firms.id, firmId));
  await audit(db, { firmId, userId: actorId, action: "settings", entity: "firm", summary: "Changed business details" });
}

// ─── Companies ───────────────────────────────────────────────────────────────

export async function listCompanies(db: DB) {
  return db
    .select({ id: firms.id, name: firms.name, country: firms.country, taxId: firms.gstin, active: firms.active, createdAt: firms.createdAt })
    .from(firms)
    .orderBy(asc(firms.id));
}

export async function createCompany(db: DB, raw: z.input<typeof companySchema>, actorId: number) {
  return db.transaction(async (tx) => {
    const id = await insertCompany(tx as unknown as DB, raw);
    await audit(tx, { firmId: id, userId: actorId, action: "create", entity: "firm", entityId: id, summary: `Added company "${String((raw as { name?: string }).name ?? "").trim()}"` });
    return id;
  });
}

export async function setCompanyActive(db: DB, firmId: number, active: boolean, actorId: number) {
  const [f] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!f) throw new MasterError("That company no longer exists.");
  if (!active) {
    const [others] = await db.select({ n: sql<number>`count(*)::int` }).from(firms).where(and(eq(firms.active, true), ne(firms.id, firmId)));
    if (others.n === 0) throw new MasterError("At least one company must stay active.");
  }
  await db.update(firms).set({ active, updatedAt: new Date() }).where(eq(firms.id, firmId));
  await audit(db, { firmId, userId: actorId, action: "settings", entity: "firm", entityId: firmId, summary: `${active ? "Re-activated" : "Hid"} company "${f.name}"` });
}
