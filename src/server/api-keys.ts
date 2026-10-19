import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { apiKeys, firms, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { MasterError } from "./errors";

/*
 * Keys that let a program enter data into one company through /api/v1. The key is shown once; only its
 * SHA-256 is stored, so a stolen database copy can't be used to call the API. Entries made with a key are
 * made in the name of the person who created it.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Makes a key for `firmId`. Returns the key itself, which is never shown again. */
export async function createApiKey(db: DB, firmId: number, name: string, userId: number): Promise<{ id: number; token: string }> {
  const clean = name.trim();
  if (!clean) throw new MasterError("Give the key a name, e.g. Claude bookkeeping.", "name");
  if (clean.length > 80) throw new MasterError("Keep the name under 80 characters.", "name");
  const [f] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId));
  if (!f) throw new MasterError("That company no longer exists.", "firmId");
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

/** Who a request's key belongs to, or null for an unknown or revoked key. Notes when it was last used. */
export async function verifyApiKey(db: DB, token: string) {
  if (!/^bk_[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [k] = await db
    .select({ id: apiKeys.id, name: apiKeys.name, firmId: apiKeys.firmId, userId: apiKeys.createdBy, country: firms.country, active: users.active })
    .from(apiKeys)
    .innerJoin(firms, eq(firms.id, apiKeys.firmId))
    .innerJoin(users, eq(users.id, apiKeys.createdBy))
    .where(and(eq(apiKeys.tokenHash, hash(token)), isNull(apiKeys.revokedAt)));
  // A key stops working when the person who made it is deactivated.
  if (!k || !k.active) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
  return { keyId: k.id, keyName: k.name, firmId: k.firmId, userId: k.userId, country: k.country as "IN" | "SA" };
}
