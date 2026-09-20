import "server-only";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, notifications } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";
import { channelStatus, sendEmail, sendWhatsApp } from "./channels";

export interface NewMessage {
  kind: "payment_reminder" | "owner_alert" | "party_update" | "service_reminder" | "manual";
  channel: "whatsapp" | "email";
  toAddress: string;
  toName?: string | null;
  subject?: string | null;
  body: string;
  dedupeKey?: string;
  refType?: string;
  refId?: number;
  partyId?: number;
}

const MAX_ATTEMPTS = 4;

/** Adds a message to the outbox. Returns its id, or null if the same message (same dedupe key) was already queued. */
export async function enqueue(db: DB, firmId: number, m: NewMessage): Promise<number | null> {
  const waManual = m.channel === "whatsapp" && !channelStatus().whatsappApi;
  const [row] = await db
    .insert(notifications)
    .values({
      firmId,
      kind: m.kind,
      channel: m.channel,
      toAddress: m.toAddress,
      toName: m.toName ?? null,
      subject: m.subject ?? null,
      body: m.body,
      status: waManual ? "manual" : "pending",
      dedupeKey: m.dedupeKey ?? null,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      partyId: m.partyId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return row?.id ?? null;
}

/** Best channel for a party: WhatsApp if they have a phone number, otherwise email. */
export function partyChannel(country: "IN" | "SA", p: { phone: string | null; email: string | null }): { channel: "whatsapp" | "email"; toAddress: string } | null {
  const phone = normalizePhone(p.phone, country);
  if (phone) return { channel: "whatsapp", toAddress: phone };
  if (p.email) return { channel: "email", toAddress: p.email };
  return null;
}

/** Owner alerts go to every contact the owner filled in (WhatsApp number and/or email). */
export async function enqueueOwnerAlert(db: DB, firmId: number, country: "IN" | "SA", subject: string, body: string, key?: string) {
  const s = await getSettings(db, firmId);
  const phone = normalizePhone(s.notifyOwnerPhone, country);
  if (phone) await enqueue(db, firmId, { kind: "owner_alert", channel: "whatsapp", toAddress: phone, subject, body, dedupeKey: key && `${key}:wa` });
  if (s.notifyOwnerEmail) await enqueue(db, firmId, { kind: "owner_alert", channel: "email", toAddress: s.notifyOwnerEmail, subject, body, dedupeKey: key && `${key}:em` });
}

/** Sends what is waiting. Safe to run often; each message is tried a few times, then marked failed. */
export async function processOutbox(db: DB, opts: { limit?: number } = {}) {
  const due = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.status, "pending"), lte(notifications.scheduledFor, new Date())))
    .orderBy(asc(notifications.id))
    .limit(opts.limit ?? 50);
  const out = { sent: 0, failed: 0, retry: 0 };
  for (const n of due) {
    const r =
      n.channel === "whatsapp"
        ? channelStatus().whatsappApi
          ? await sendWhatsApp(n.toAddress, n.body)
          : ({ ok: false, error: "manual" } as const)
        : await sendEmail(n.toAddress, n.subject ?? "Message from your business", n.body);
    if (r.ok) {
      await db.update(notifications).set({ status: "sent", sentAt: new Date(), attempts: n.attempts + 1, lastError: null }).where(eq(notifications.id, n.id));
      out.sent++;
    } else if (r.error === "manual") {
      await db.update(notifications).set({ status: "manual" }).where(eq(notifications.id, n.id));
    } else {
      const attempts = n.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await db
        .update(notifications)
        .set({ status: final ? "failed" : "pending", attempts, lastError: r.error, scheduledFor: new Date(Date.now() + attempts * 10 * 60_000) })
        .where(eq(notifications.id, n.id));
      if (final) out.failed++;
      else out.retry++;
    }
  }
  return out;
}

export async function listMessages(db: DB, firmId: number, opts: { status?: string; limit?: number } = {}) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.firmId, firmId), opts.status ? eq(notifications.status, opts.status) : sql`true`))
    .orderBy(desc(notifications.id))
    .limit(opts.limit ?? 200);
}

export async function messageCounts(db: DB, firmId: number) {
  const rows = await db.select({ status: notifications.status, n: sql<number>`count(*)::int` }).from(notifications).where(eq(notifications.firmId, firmId)).groupBy(notifications.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export async function markMessage(db: DB, firmId: number, id: number, action: "sent" | "retry" | "cancel") {
  const set = action === "sent" ? { status: "sent", sentAt: new Date() } : action === "cancel" ? { status: "cancelled" } : { status: "pending", attempts: 0, lastError: null, scheduledFor: new Date() };
  await db.update(notifications).set(set).where(and(eq(notifications.firmId, firmId), eq(notifications.id, id), inArray(notifications.status, ["manual", "failed", "pending"])));
}

export async function activeFirms(db: DB) {
  return db.select({ id: firms.id, name: firms.name, country: firms.country }).from(firms).where(eq(firms.active, true)).orderBy(asc(firms.id));
}
