import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { apiKeys, firms, roles, users, vouchers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/settings";
import { MasterError } from "./errors";

/*
 * Keys that let a program enter data into one company through /api/v1. The key is shown once; only its
 * SHA-256 is stored, so a stolen database copy can't be used to call the API. Entries made with a key are
 * made in the name of the person who created it.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const API_EMAIL = "api@system.invalid";

/**
 * The built-in "API" user every API entry is recorded under, made the first time a key is made. It holds a
 * role with no permissions, is deactivated and has no usable password, so it can never sign in.
 */
export async function ensureApiUser(db: DB): Promise<number> {
  const [have] = await db.select({ id: users.id }).from(users).where(eq(users.isApi, true)).limit(1);
  if (have) return have.id;
  let [role] = await db.select({ id: roles.id }).from(roles).where(and(sql`lower(${roles.name}) = 'api'`, isNull(roles.firmId), eq(roles.isSystem, true)));
  if (!role) {
    [role] = await db
      .insert(roles)
      .values({ name: "API", description: "Held only by the built-in API user, which records entries made through API keys. Can't sign in.", permissions: [], isSystem: true })
      .returning({ id: roles.id });
  }
  const [made] = await db
    .insert(users)
    .values({ name: "API", email: API_EMAIL, passwordHash: "!", roleId: role.id, active: false, mustChangePassword: false, isApi: true })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (made) return made.id;
  const [again] = await db.select({ id: users.id }).from(users).where(eq(users.isApi, true)).limit(1);
  return again.id;
}

/** Owner only: whether API keys may be used for a company. Keys of a company with it off stop working. */
export async function setApiEnabled(db: DB, firmId: number, enabled: boolean, userId: number) {
  const [f] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId));
  if (!f) throw new MasterError("That company no longer exists.");
  await saveSettings(db, firmId, { apiEnabled: enabled });
  await audit(db, { firmId, userId, action: "settings", entity: "firm", entityId: firmId, summary: `${enabled ? "Turned on" : "Turned off"} API access for "${f.name}"` });
}

/** The latest entries made through the API in these companies, newest first. */
export async function recentApiEntries(db: DB, firmIds: number[] | "all", limit = 30) {
  return db
    .select({ id: vouchers.id, firmName: firms.name, type: vouchers.type, prefix: vouchers.prefix, number: vouchers.number, date: vouchers.date, partyName: vouchers.partyName, totalPaise: vouchers.totalPaise, status: vouchers.status, createdAt: vouchers.createdAt })
    .from(vouchers)
    .innerJoin(users, eq(users.id, vouchers.createdBy))
    .innerJoin(firms, eq(firms.id, vouchers.firmId))
    .where(and(eq(users.isApi, true), firmIds === "all" ? undefined : inArray(vouchers.firmId, firmIds.length ? firmIds : [0])))
    .orderBy(desc(vouchers.id))
    .limit(limit);
}

/** Makes a key for `firmId`. Returns the key itself, which is never shown again. */
export async function createApiKey(db: DB, firmId: number, name: string, userId: number): Promise<{ id: number; token: string }> {
  const clean = name.trim();
  if (!clean) throw new MasterError("Give the key a name, e.g. Claude bookkeeping.", "name");
  if (clean.length > 80) throw new MasterError("Keep the name under 80 characters.", "name");
  const [f] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId));
  if (!f) throw new MasterError("That company no longer exists.", "firmId");
  if (!(await getSettings(db, firmId)).apiEnabled) throw new MasterError(`API access is off for ${f.name}. The owner turns it on under Settings → Companies.`, "firmId");
  await ensureApiUser(db);
  const token = `bk_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(apiKeys).values({ firmId, name: clean, tokenHash: hash(token), hint: token.slice(0, 7), createdBy: userId }).returning({ id: apiKeys.id });
  await audit(db, { firmId, userId, action: "create", entity: "api_key", entityId: row.id, summary: `Made API key "${clean}" for ${f.name}` });
  return { id: row.id, token };
}

export async function listApiKeys(db: DB, firmIds: number[] | "all") {
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, hint: apiKeys.hint, firmId: apiKeys.firmId, firmName: firms.name, createdBy: users.name, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .innerJoin(firms, eq(firms.id, apiKeys.firmId))
    .innerJoin(users, eq(users.id, apiKeys.createdBy))
    .where(firmIds === "all" ? undefined : inArray(apiKeys.firmId, firmIds.length ? firmIds : [0]))
    .orderBy(desc(apiKeys.id));
}

export async function revokeApiKey(db: DB, id: number, firmIds: number[] | "all", userId: number) {
  const [k] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
  if (!k || (firmIds !== "all" && !firmIds.includes(k.firmId))) throw new MasterError("That key no longer exists.");
  if (k.revokedAt) return;
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  await audit(db, { firmId: k.firmId, userId, action: "settings", entity: "api_key", entityId: id, summary: `Revoked API key "${k.name}"` });
}

/**
 * Who a request's key belongs to: its company, and the API user its entries are recorded under. "off" when
 * the company's API access is turned off; null for an unknown or revoked key, or one whose maker has been
 * deactivated.
 */
export async function verifyApiKey(db: DB, token: string): Promise<null | "off" | { keyId: number; keyName: string; madeBy: string; firmId: number; userId: number; country: "IN" | "SA" }> {
  if (!/^bk_[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [k] = await db
    .select({ id: apiKeys.id, name: apiKeys.name, firmId: apiKeys.firmId, country: firms.country, active: users.active, madeBy: users.name })
    .from(apiKeys)
    .innerJoin(firms, eq(firms.id, apiKeys.firmId))
    .innerJoin(users, eq(users.id, apiKeys.createdBy))
    .where(and(eq(apiKeys.tokenHash, hash(token)), isNull(apiKeys.revokedAt)));
  if (!k || !k.active) return null;
  if (!(await getSettings(db, k.firmId)).apiEnabled) return "off";
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
  return { keyId: k.id, keyName: k.name, madeBy: k.madeBy, firmId: k.firmId, userId: await ensureApiUser(db), country: k.country as "IN" | "SA" };
}
