import "server-only";
import { createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import * as OTPAuth from "otpauth";
import { getDb } from "@/db";
import { firms, loginAttempts, roles, sessions, userFirms, users } from "@/db/schema";
import { can, type Permission } from "./permissions";
import { setRegion, type Country } from "./region";

const COOKIE = "sid";
const SESSION_HOURS = 12;
const IDLE_MINUTES = 120;
const MAX_FAILS_PER_ACCOUNT = 5;
const MAX_FAILS_PER_IP = 30;
const LOCK_MINUTES = 15;

export interface CompanyRef {
  id: number;
  name: string;
  country: Country;
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  roleId: number;
  roleName: string;
  isOwner: boolean;
  permissions: string[];
  /** The company being worked in right now (id 0 if the user has no company access). */
  firmId: number;
  firm: CompanyRef;
  /** Every company this user may open. */
  firms: CompanyRef[];
  totpEnabled: boolean;
  mustChangePassword: boolean;
  sessionId: string;
}

// ─── Passwords ────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, password);
  } catch {
    return false;
  }
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (/^(.)\1+$/.test(password)) return "Don't repeat one character.";
  const common = ["password", "1234567890", "qwertyuiop", "billing123", "admin12345"];
  if (common.some((c) => password.toLowerCase().includes(c))) return "That password is too easy to guess.";
  return null;
}

// ─── Request info ─────────────────────────────────────────────────────────────

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

// ─── Login throttling ────────────────────────────────────────────────────────

export async function loginBlockedReason(email: string, ip: string): Promise<string | null> {
  const db = await getDb();
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000);
  const [byIp] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.ok, false), gt(loginAttempts.at, since)));
  if (byIp.n >= MAX_FAILS_PER_IP) return `Too many failed sign-ins from this network. Try again in ${LOCK_MINUTES} minutes.`;
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return `This account is locked after too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
  }
  return null;
}

export async function recordLoginAttempt(email: string, ip: string, ok: boolean, userId?: number) {
  const db = await getDb();
  await db.insert(loginAttempts).values({ email: email.toLowerCase().slice(0, 200), ip, ok });
  if (!userId) return;
  if (ok) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, userId));
  } else {
    const [u] = await db
      .update(users)
      .set({ failedLogins: sql`${users.failedLogins} + 1` })
      .where(eq(users.id, userId))
      .returning({ failed: users.failedLogins });
    if (u && u.failed >= MAX_FAILS_PER_ACCOUNT) {
      await db
        .update(users)
        .set({ lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedLogins: 0 })
        .where(eq(users.id, userId));
    }
  }
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(userId: number, mfaPassed: boolean): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    mfaPassed,
    ip: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000),
  });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }
  jar.delete(COOKIE);
}

async function loadSession(): Promise<{ user: CurrentUser; mfaPassed: boolean } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const id = sha256(token);
  const [row] = await db
    .select({ s: sessions, u: users, r: roles })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(sessions.id, id));
  if (!row) return null;
  const now = Date.now();
  const idleExpired = now - row.s.lastSeenAt.getTime() > IDLE_MINUTES * 60_000;
  if (row.s.expiresAt.getTime() < now || idleExpired || !row.u.active) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (now - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
  const companyCols = { id: firms.id, name: firms.name, country: firms.country };
  const accessible = (
    row.r.isOwner
      ? await db.select(companyCols).from(firms).where(eq(firms.active, true)).orderBy(asc(firms.id))
      : await db
          .select(companyCols)
          .from(userFirms)
          .innerJoin(firms, eq(firms.id, userFirms.firmId))
          .where(and(eq(userFirms.userId, row.u.id), eq(firms.active, true)))
          .orderBy(asc(firms.id))
  ).map((f) => ({ ...f, country: (f.country === "SA" ? "SA" : "IN") as Country }));
  const current = accessible.find((f) => f.id === row.s.firmId) ?? accessible[0] ?? { id: 0, name: "", country: "IN" as Country };
  if (current.id && current.id !== row.s.firmId) await db.update(sessions).set({ firmId: current.id }).where(eq(sessions.id, id));
  return {
    mfaPassed: row.s.mfaPassed,
    user: {
      firmId: current.id,
      firm: current,
      firms: accessible,
      id: row.u.id,
      name: row.u.name,
      email: row.u.email,
      roleId: row.r.id,
      roleName: row.r.name,
      isOwner: row.r.isOwner,
      permissions: row.r.permissions,
      totpEnabled: row.u.totpEnabled,
      mustChangePassword: row.u.mustChangePassword,
      sessionId: id,
    },
  };
}

/** The signed-in user, or null. Two-step login must be complete. */
export async function currentUser(): Promise<CurrentUser | null> {
  const s = await loadSession();
  if (!s) return null;
  if (s.user.totpEnabled && !s.mfaPassed) return null;
  return s.user;
}

/** Session that has passed the password step but still needs the 6-digit code. */
export async function pendingMfaUser(): Promise<CurrentUser | null> {
  const s = await loadSession();
  return s && s.user.totpEnabled && !s.mfaPassed ? s.user : null;
}

export async function markMfaPassed(sessionId: string) {
  const db = await getDb();
  await db.update(sessions).set({ mfaPassed: true }).where(eq(sessions.id, sessionId));
}

/** For pages: redirects to the login page when signed out, or home when not allowed. */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) {
    if (await pendingMfaUser()) redirect("/login/code");
    redirect("/login");
  }
  if (user.firmId === 0) redirect("/no-access");
  if (permission && !can(user, permission)) redirect("/?denied=1");
  setRegion(user.firm.country);
  return user;
}

/** For server actions: throws instead of redirecting. */
export async function assertUser(permission?: Permission): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("Your session has ended. Sign in again.");
  if (user.mustChangePassword) throw new AuthError("Change your temporary password first (open any page to do it).");
  if (user.firmId === 0) throw new AuthError("You haven't been given access to any company. Ask the owner.");
  if (permission && !can(user, permission)) throw new AuthError("You don't have permission to do that.");
  setRegion(user.firm.country);
  return user;
}

export class AuthError extends Error {}

/** Move this sign-in session to another company the user is allowed to open. */
export async function switchCompany(firmId: number): Promise<void> {
  const user = await currentUser();
  if (!user) throw new AuthError("Your session has ended. Sign in again.");
  if (!user.firms.some((f) => f.id === firmId)) throw new AuthError("You don't have access to that company.");
  const db = await getDb();
  await db.update(sessions).set({ firmId }).where(eq(sessions.id, user.sessionId));
}

// ─── Two-step login (authenticator app) ──────────────────────────────────────

export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, email: string, issuer: string): string {
  return new OTPAuth.TOTP({ issuer, label: email, secret: OTPAuth.Secret.fromBase32(secret) }).toString();
}

export function verifyTotp(secret: string, code: string): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.validate({ token: clean, window: 1 }) !== null;
}

// ─── First-run setup token ───────────────────────────────────────────────────

/** The one-time setup link is derived from APP_SECRET so only someone with server access can see it. */
export function setupToken(): string {
  const secret = process.env.APP_SECRET || "development-only-secret";
  return createHmac("sha256", secret).update("first-run-setup").digest("base64url").slice(0, 32);
}

export function checkSetupToken(given: string | null | undefined): boolean {
  if (process.env.NODE_ENV !== "production" && !process.env.APP_SECRET) return true;
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(setupToken());
  return a.length === b.length && timingSafeEqual(a, b);
}
