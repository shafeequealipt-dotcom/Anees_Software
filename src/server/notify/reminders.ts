import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, notifications, parties } from "@/db/schema";
import { daysBetween, formatDate, todayIST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { setRegion } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { listVouchers } from "../reports";
import { enqueue, partyChannel } from "./outbox";

/**
 * Sends one reminder per customer who has overdue bills, following the company's cadence:
 * the first one N days after the oldest bill fell due, then every M days, up to a maximum.
 * Runs once a day (and is safe to run more often: one reminder per customer per day at most).
 */
export async function runPaymentReminders(db: DB, firmId: number): Promise<{ queued: number; considered: number }> {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) return { queued: 0, considered: 0 };
  const cfg = await getSettings(db, firmId);
  if (!cfg.paymentReminders) return { queued: 0, considered: 0 };
  const country = firm.country === "SA" ? "SA" : "IN";
  setRegion(country);
  const today = todayIST();

  const overdue = await listVouchers(db, firmId, { types: ["sale_invoice"], status: "overdue", limit: 5000 });
  const byParty = new Map<number, typeof overdue>();
  for (const v of overdue) {
    if (!v.party_id) continue;
    byParty.set(v.party_id, [...(byParty.get(v.party_id) ?? []), v]);
  }
  if (byParty.size === 0) return { queued: 0, considered: 0 };

  const ids = [...byParty.keys()];
  const people = await db.select().from(parties).where(and(eq(parties.firmId, firmId), inArray(parties.id, ids), eq(parties.active, true)));
  const history = await db
    .select({ partyId: notifications.partyId, last: sql<Date>`max(${notifications.createdAt})`, n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.firmId, firmId), eq(notifications.kind, "payment_reminder"), inArray(notifications.partyId, ids), gte(notifications.createdAt, new Date(Date.now() - 400 * 86400_000))))
    .groupBy(notifications.partyId);
  const past = new Map(history.map((h) => [h.partyId, h]));

  let queued = 0;
  for (const p of people) {
    const target = partyChannel(country, p);
    if (!target) continue;
    const bills = byParty.get(p.id)!.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
    const oldest = bills[0].due_date!;
    const h = past.get(p.id);
    const lastDay = h ? new Date(h.last).toISOString().slice(0, 10) : null;
    const due = h ? daysBetween(lastDay!, today) >= cfg.reminderEveryDays : daysBetween(oldest, today) >= cfg.reminderFirstAfterDays;
    if (!due) continue;
    if ((h?.n ?? 0) >= cfg.reminderMaxCount) continue;

    const total = bills.reduce((s, b) => s + b.balance_paise, 0);
    const list = bills
      .slice(0, 5)
      .map((b) => `${b.prefix}${b.number} (due ${formatDate(b.due_date)}): ${formatMoney(b.balance_paise)}`)
      .join("\n");
    const body =
      cfg.reminderMessage.replace("{party}", p.name).replace("{amount}", formatMoney(total)).replace("{business}", firm.name) +
      `\n\n${list}${bills.length > 5 ? `\n…and ${bills.length - 5} more` : ""}`;
    const id = await enqueue(db, firmId, {
      kind: "payment_reminder",
      channel: target.channel,
      toAddress: target.toAddress,
      toName: p.name,
      subject: `Payment reminder from ${firm.name}`,
      body,
      dedupeKey: `reminder:${p.id}:${today}`,
      partyId: p.id,
      refType: "party",
      refId: p.id,
    });
    if (id) queued++;
  }
  return { queued, considered: people.length };
}
