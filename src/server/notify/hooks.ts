import "server-only";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, parties, users, vouchers } from "@/db/schema";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { setRegion } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import { enqueue, enqueueOwnerAlert, partyChannel } from "./outbox";

export type TransactionEvent = "created" | "updated" | "cancelled" | "deleted";

const ALERT_TYPES = new Set(["sale_invoice", "purchase_bill", "credit_note", "debit_note", "payment_in", "payment_out", "expense", "other_income"]);
const PARTY_TYPES = new Set(["sale_invoice", "credit_note", "payment_in", "quotation", "sales_order"]);

/**
 * Called after a bill is saved, changed, cancelled or deleted. Queues an alert to the owner and/or a note to the party,
 * depending on the company's messaging settings. Never throws: a messaging problem must not undo a saved bill.
 */
export async function notifyTransaction(db: DB, firmId: number, actorId: number, voucherId: number, event: TransactionEvent): Promise<void> {
  try {
    const cfg = await getSettings(db, firmId);
    if (!cfg.notifyOwnerOnNewTransaction && !cfg.notifyPartyOnChange) return;
    const [v] = await db.select().from(vouchers).where(and(eq(vouchers.id, voucherId), eq(vouchers.firmId, firmId)));
    const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
    if (!v || !firm) return;
    const country = firm.country === "SA" ? "SA" : "IN";
    setRegion(country);
    const info = VOUCHER_INFO[v.type];
    const label = info.label.toLowerCase();
    const num = voucherNumber(v);
    const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
    const total = formatMoney(v.totalPaise);
    const stamp = `${voucherId}:${event}:${v.updatedAt.getTime()}`;

    if (cfg.notifyOwnerOnNewTransaction && ALERT_TYPES.has(v.type)) {
      const verb = { created: "New", updated: "Edited", cancelled: "Cancelled", deleted: "Deleted" }[event];
      const body = `${firm.name}: ${verb} ${label} ${num}${v.partyName ? ` · ${v.partyName}` : ""} · ${total} · ${formatDate(v.date)}${actor ? ` (by ${actor.name})` : ""}`;
      await enqueueOwnerAlert(db, firmId, country, `${verb} ${label} ${num}`, body, `owner:${stamp}`);
    }

    if (cfg.notifyPartyOnChange && event !== "created" && PARTY_TYPES.has(v.type) && v.partyId) {
      const [p] = await db.select().from(parties).where(and(eq(parties.id, v.partyId), eq(parties.firmId, firmId)));
      const target = p && partyChannel(country, p);
      if (p && target) {
        const what =
          event === "updated" ? `has been updated. The new total is ${total}.` : event === "cancelled" ? "has been cancelled." : "has been removed.";
        const body = `Dear ${p.name}, our ${label} ${num} dated ${formatDate(v.date)} ${what}\n\nThank you,\n${firm.name}`;
        await enqueue(db, firmId, { kind: "party_update", channel: target.channel, toAddress: target.toAddress, toName: p.name, subject: `Update to ${label} ${num}`, body, dedupeKey: `party:${stamp}`, partyId: p.id, refType: "voucher", refId: voucherId });
      }
    }
  } catch (e) {
    console.error("notifyTransaction failed", e);
  }
}
