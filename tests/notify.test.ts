import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, notifications, taxRates } from "@/db/schema";
import { addDays, todayIST } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { saveSettings } from "@/lib/settings";
import { saveParty } from "@/server/masters";
import { notifyTransaction } from "@/server/notify/hooks";
import { enqueue, listMessages, processOutbox } from "@/server/notify/outbox";
import { runPaymentReminders } from "@/server/notify/reminders";
import { runFirstSetup } from "@/server/setup";
import { saveVoucher } from "@/server/vouchers";
import { testDb } from "./helpers/db";

let db: DB;
let firmId: number;
let party: number;

beforeAll(async () => {
  db = await testDb();
  await runFirstSetup(db, { businessName: "Test Traders", stateCode: "27", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" });
  [{ id: firmId }] = await db.select({ id: firms.id }).from(firms);
  party = await saveParty(db, firmId, { name: "Ravi Stores", kind: "customer", phone: "98765 43210", stateCode: "27" }, 1);
  const today = todayIST();
  await saveVoucher(db, firmId, { type: "sale_invoice", date: addDays(today, -20), dueDate: addDays(today, -10), partyId: party, paidPaise: 0, lines: [{ description: "Goods", qtyMilli: 1000, ratePaise: 100_000 }] }, 1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("phone numbers", () => {
  it("turns local numbers into international ones", () => {
    expect(normalizePhone("98765 43210", "IN")).toBe("919876543210");
    expect(normalizePhone("+91 98765-43210", "IN")).toBe("919876543210");
    expect(normalizePhone("0551234567", "SA")).toBe("966551234567");
    expect(normalizePhone("551234567", "SA")).toBe("966551234567");
    expect(normalizePhone("abc", "IN")).toBeNull();
    expect(normalizePhone("123", "IN")).toBeNull();
  });
});

describe("payment reminders", () => {
  it("does nothing until reminders are switched on", async () => {
    expect((await runPaymentReminders(db, firmId)).queued).toBe(0);
  });

  it("sends one reminder per customer per day, then waits, then stops after the maximum", async () => {
    await saveSettings(db, firmId, { paymentReminders: true, reminderFirstAfterDays: 1, reminderEveryDays: 7, reminderMaxCount: 2 });
    const first = await runPaymentReminders(db, firmId);
    expect(first.queued).toBe(1);
    const [m] = await listMessages(db, firmId);
    expect(m).toMatchObject({ kind: "payment_reminder", channel: "whatsapp", toAddress: "919876543210", status: "manual" });
    expect(m.body).toMatch(/Ravi Stores/);
    expect(m.body).toMatch(/INV-1/);

    expect((await runPaymentReminders(db, firmId)).queued).toBe(0); // same day, and too soon
    // pretend that reminder was sent 8 days ago
    await db.update(notifications).set({ createdAt: new Date(Date.now() - 8 * 86400_000), dedupeKey: "old-1" }).where(eq(notifications.id, m.id));
    expect((await runPaymentReminders(db, firmId)).queued).toBe(1);
    await db.update(notifications).set({ createdAt: new Date(Date.now() - 20 * 86400_000), dedupeKey: sql`'old-' || ${notifications.id}::text` });
    expect((await runPaymentReminders(db, firmId)).queued).toBe(0); // maximum of 2 reached
  });

  it("skips customers with no phone or email", async () => {
    const quiet = await saveParty(db, firmId, { name: "No Contact Co", kind: "customer", stateCode: "27" }, 1);
    const today = todayIST();
    await saveVoucher(db, firmId, { type: "sale_invoice", date: addDays(today, -30), dueDate: addDays(today, -20), partyId: quiet, paidPaise: 0, lines: [{ description: "x", qtyMilli: 1000, ratePaise: 5000 }] }, 1);
    const before = (await listMessages(db, firmId)).length;
    await runPaymentReminders(db, firmId);
    expect((await listMessages(db, firmId)).filter((m) => m.partyId === quiet)).toHaveLength(0);
    expect((await listMessages(db, firmId)).length).toBeGreaterThanOrEqual(before);
  });
});

describe("sending", () => {
  it("de-duplicates by key", async () => {
    const a = await enqueue(db, firmId, { kind: "manual", channel: "email", toAddress: "x@y.example", body: "hi", dedupeKey: "same" });
    const b = await enqueue(db, firmId, { kind: "manual", channel: "email", toAddress: "x@y.example", body: "hi", dedupeKey: "same" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("sends WhatsApp through the API when connected, and retries then fails after repeated errors", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345");
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid" }] }), { status: 200 });
    });
    const id = (await enqueue(db, firmId, { kind: "owner_alert", channel: "whatsapp", toAddress: "919800000000", body: "New sale INV-9", dedupeKey: "wa-1" }))!;
    expect((await db.select().from(notifications).where(eq(notifications.id, id)))[0].status).toBe("pending");
    const out = await processOutbox(db);
    expect(out.sent).toBeGreaterThanOrEqual(1);
    expect(calls[0].url).toContain("/12345/messages");
    expect(JSON.parse(calls[0].body)).toMatchObject({ to: "919800000000", type: "text" });
    expect((await db.select().from(notifications).where(eq(notifications.id, id)))[0].status).toBe("sent");

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Recipient not in allowed list" } }), { status: 400 }));
    const bad = (await enqueue(db, firmId, { kind: "owner_alert", channel: "whatsapp", toAddress: "919800000001", body: "x", dedupeKey: "wa-2" }))!;
    for (let i = 0; i < 4; i++) {
      await db.update(notifications).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(notifications.id, bad));
      await processOutbox(db);
    }
    const row = (await db.select().from(notifications).where(eq(notifications.id, bad)))[0];
    expect(row.status).toBe("failed");
    expect(row.lastError).toMatch(/not in allowed list/);
  });
});

describe("transaction alerts", () => {
  it("tells the owner about a new bill only when switched on, and the party about a change", async () => {
    const today = todayIST();
    const v = await saveVoucher(db, firmId, { type: "sale_invoice", date: today, partyId: party, paidPaise: 0, lines: [{ description: "Goods", qtyMilli: 1000, ratePaise: 50_000 }] }, 1);
    const count = async () => (await listMessages(db, firmId, { limit: 1000 })).length;
    const n0 = await count();
    await notifyTransaction(db, firmId, 1, v.id, "created");
    expect(await count()).toBe(n0);

    await saveSettings(db, firmId, { notifyOwnerOnNewTransaction: true, notifyOwnerPhone: "9811122233", notifyOwnerEmail: "boss@t.example", notifyPartyOnChange: true });
    await notifyTransaction(db, firmId, 1, v.id, "created");
    const created = (await listMessages(db, firmId, { limit: 1000 })).slice(0, 2);
    expect(created.map((m) => m.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(created[0].body).toMatch(/New sale invoice INV-/);

    await notifyTransaction(db, firmId, 1, v.id, "cancelled");
    const partyMsg = (await listMessages(db, firmId, { limit: 1000 })).find((m) => m.kind === "party_update");
    expect(partyMsg?.body).toMatch(/has been cancelled/);
    expect(partyMsg?.toAddress).toBe("919876543210");
  });
});
