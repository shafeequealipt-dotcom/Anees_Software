"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { firms, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  checkSetupToken,
  clientIp,
  createSession,
  currentUser,
  destroySession,
  loginBlockedReason,
  markMfaPassed,
  pendingMfaUser,
  recordLoginAttempt,
  verifyPassword,
  verifyTotp,
} from "@/lib/auth";
import { MasterError } from "@/server/masters";
import { runFirstSetup } from "@/server/setup";

export type FormState = { error?: string; field?: string; ok?: boolean; message?: string } | null;

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const ip = await clientIp();
  const blocked = await loginBlockedReason(email, ip);
  if (blocked) return { error: blocked };

  const db = await getDb();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  const ok = !!user && user.active && (await verifyPassword(user.passwordHash, password));
  await recordLoginAttempt(email, ip, ok, user?.id);
  if (!ok) return { error: "That email and password don't match. Check for typos and try again." };

  await createSession(user.id, !user.totpEnabled);
  await audit(db, { userId: user.id, action: "login", entity: "user", entityId: user.id, summary: `${user.name} signed in`, ip });
  redirect(user.totpEnabled ? "/login/code" : "/");
}

export async function verifyCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const pending = await pendingMfaUser();
  if (!pending) redirect("/login");
  const code = String(form.get("code") ?? "");
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, pending.id));
  const ip = await clientIp();
  const blocked = await loginBlockedReason(user.email, ip);
  if (blocked) return { error: blocked };
  if (!user.totpSecret || !verifyTotp(user.totpSecret, code)) {
    await recordLoginAttempt(user.email, ip, false, user.id);
    return { error: "That code didn't work. Codes change every 30 seconds — use the newest one." };
  }
  await markMfaPassed(pending.sessionId);
  redirect("/");
}

export async function logoutAction() {
  const user = await currentUser();
  await destroySession();
  if (user) {
    const db = await getDb();
    await audit(db, { userId: user.id, action: "logout", entity: "user", entityId: user.id, summary: `${user.name} signed out` });
  }
  redirect("/login");
}

export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!checkSetupToken(String(form.get("token") ?? ""))) {
    return { error: "This setup link isn't valid. Get a fresh link from the server with: sudo billing setup-link" };
  }
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("password2") ?? "")) return { error: "The two passwords don't match.", field: "password2" };
  const db = await getDb();
  try {
    const userId = await runFirstSetup(db, {
      businessName: String(form.get("businessName") ?? ""),
      gstin: String(form.get("gstin") ?? "") || undefined,
      gstScheme: (String(form.get("gstScheme") ?? "regular") as "regular" | "composition" | "unregistered"),
      country: (String(form.get("country") ?? "IN") === "SA" ? "SA" : "IN"),
      stateCode: String(form.get("stateCode") ?? ""),
      address: String(form.get("address") ?? ""),
      phone: String(form.get("phone") ?? ""),
      ownerName: String(form.get("ownerName") ?? ""),
      email: String(form.get("email") ?? ""),
      password,
    });
    await createSession(userId, true);
  } catch (e) {
    if (e instanceof MasterError) return { error: e.message, field: e.field };
    throw e;
  }
  redirect("/?welcome=1");
}

export async function businessName(): Promise<string> {
  const db = await getDb();
  const [f] = await db.select({ name: firms.name }).from(firms).where(eq(firms.isDefault, true));
  return f?.name ?? "Billing";
}
