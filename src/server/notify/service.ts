import "server-only";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { firms, items, parties, serviceReminders, vouchers, voucherLines } from "@/db/schema";
import { addDays, formatDate, todayIST } from "@/lib/dates";
import { setRegion } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { enqueue, enqueueOwnerAlert, partyChannel } from "./outbox";

/** Rebuilds the service reminders of one sale bill from its lines. Cancelled, deleted and non-sale bills have none. */
export async function syncServiceReminders(db: DB | Tx, firmId: number, voucherId: number) {
  await db.delete(serviceReminders).where(and(eq(serviceReminders.voucherId, voucherId), eq(serviceReminders.status, "pending")));
  const [v] = await db.select().from(vouchers).where(and(eq(vouchers.id, voucherId), eq(vouchers.firmId, firmId)));
  if (!v || v.status !== "active" || v.type !== "sale_invoice" || !v.partyId) return;
  const lines = await db
    .select({ itemId: voucherLines.itemId, desc: voucherLines.description, days: items.serviceIntervalDays })
    .from(voucherLines)
    .innerJoin(items, eq(items.id, voucherLines.itemId))
    .where(and(eq(voucherLines.voucherId, voucherId), sql`${items.serviceIntervalDays} is not null`));
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceReminders).where(eq(serviceReminders.voucherId, voucherId));
  if (lines.length === 0 || existing.n > 0) return; // done ones stay; don't add a second copy
  await db.insert(serviceReminders).values(lines.map((l) => ({ firmId, voucherId, partyId: v.partyId, itemId: l.itemId, itemName: l.desc, dueDate: addDays(v.date, l.days!) })));
}

export async function listServiceReminders(db: DB, firmId: number, opts: { status?: "pending" | "done" } = {}) {
  return db
    .select({
      id: serviceReminders.id,
      itemName: serviceReminders.itemName,
      dueDate: serviceReminders.dueDate,
      status: serviceReminders.status,
      notifiedAt: serviceReminders.notifiedAt,
      partyId: serviceReminders.partyId,
      partyName: parties.name,
      phone: parties.phone,
      voucherId: serviceReminders.voucherId,
      vPrefix: vouchers.prefix,
      vNumber: vouchers.number,
    })
    .from(serviceReminders)
    .leftJoin(parties, eq(parties.id, serviceReminders.partyId))
    .innerJoin(vouchers, eq(vouchers.id, serviceReminders.voucherId))
    .where(and(eq(serviceReminders.firmId, firmId), opts.status ? eq(serviceReminders.status, opts.status) : undefined))
    .orderBy(asc(serviceReminders.dueDate), asc(serviceReminders.id))
    .limit(500);
}

export async function markServiceDone(db: DB, firmId: number, id: number) {
  await db.update(serviceReminders).set({ status: "done" }).where(and(eq(serviceReminders.id, id), eq(serviceReminders.firmId, firmId)));
}

/** Messages the customer (and, if asked, the owner) about services coming due. Runs with the daily job. */
export async function runServiceReminders(db: DB, firmId: number): Promise<{ queued: number }> {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) return { queued: 0 };
  const cfg = await getSettings(db, firmId);
  if (!cfg.serviceReminders) return { queued: 0 };
  const country = firm.country === "SA" ? "SA" : "IN";
  setRegion(country);
  const horizon = addDays(todayIST(), cfg.serviceLeadDays);
  const due = await db
    .select({ r: serviceReminders, p: parties })
    .from(serviceReminders)
    .innerJoin(parties, eq(parties.id, serviceReminders.partyId))
    .where(and(eq(serviceReminders.firmId, firmId), eq(serviceReminders.status, "pending"), isNull(serviceReminders.notifiedAt), lte(serviceReminders.dueDate, horizon)));
  let queued = 0;
  for (const { r, p } of due) {
    const target = partyChannel(country, p);
    const body = cfg.serviceMessage.replace("{party}", p.name).replace("{item}", r.itemName).replace("{date}", formatDate(r.dueDate)).replace("{business}", firm.name);
    if (target) {
      const id = await enqueue(db, firmId, { kind: "service_reminder", channel: target.channel, toAddress: target.toAddress, toName: p.name, subject: `Service reminder from ${firm.name}`, body, dedupeKey: `service:${r.id}`, partyId: p.id, refType: "voucher", refId: r.voucherId });
      if (id) queued++;
    } else {
      await enqueueOwnerAlert(db, firmId, country, `Service due: ${p.name}`, `${p.name} has no phone or email. Service due ${formatDate(r.dueDate)} for ${r.itemName}. Please call them.`, `service-owner:${r.id}`);
    }
    await db.update(serviceReminders).set({ notifiedAt: new Date() }).where(eq(serviceReminders.id, r.id));
  }
  return { queued };
}
