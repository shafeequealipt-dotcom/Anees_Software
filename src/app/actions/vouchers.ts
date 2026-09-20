"use server";

import { region } from "@/lib/region";
import { randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { notifications, parties, partyLedger, shareLinks, vouchers } from "@/db/schema";
import { AuthError, assertUser, clientIp } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { SETTLES, VOUCHER_INFO } from "@/lib/voucher-types";
import { MasterError, saveParty } from "@/server/masters";
import { notifyTransaction } from "@/server/notify/hooks";
import { channelStatus } from "@/server/notify/channels";
import { enqueue, partyChannel, processOutbox } from "@/server/notify/outbox";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { whatsappLink } from "@/lib/phone";
import { cancelVoucher, deleteVoucher, getVoucher, openBills, restoreVoucher, saveVoucher, VoucherError, type VoucherInput } from "@/server/vouchers";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof VoucherError || e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong while saving. Nothing was changed — please try again." };
}

export async function saveVoucherAction(input: VoucherInput): Promise<ActionResult<{ id: number; number: string; warnings: string[] }>> {
  try {
    const user = await assertUser(input.id ? "vouchers.edit" : "vouchers.create");
    const info = VOUCHER_INFO[input.type];
    if (["money_adjustment", "money_transfer", "other_income"].includes(input.type) && !can(user, "money.edit")) {
      throw new AuthError("You don't have permission to record this.");
    }
    const db = await getDb();
    if (input.id && !can(user, "vouchers.editOld")) {
      const [v] = await db.select({ createdAt: vouchers.createdAt }).from(vouchers).where(and(eq(vouchers.id, input.id), eq(vouchers.firmId, user.firmId)));
      const created = v ? new Intl.DateTimeFormat("en-CA", { timeZone: region().timezone }).format(v.createdAt) : null;
      if (created && created !== todayIST()) throw new AuthError("Only the owner or accountant can edit entries from earlier days.");
    }
    const res = await saveVoucher(db, user.firmId, input, user.id, await clientIp());
    await notifyTransaction(db, user.firmId, user.id, res.id, input.id ? "updated" : "created");
    revalidatePath(info.path);
    revalidatePath("/");
    return { ok: true, ...res };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelVoucherAction(id: number): Promise<ActionResult> {
  try {
    const user = await assertUser("vouchers.cancel");
    const db = await getDb();
    await cancelVoucher(db, user.firmId, id, user.id, await clientIp());
    await notifyTransaction(db, user.firmId, user.id, id, "cancelled");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteVoucherAction(id: number): Promise<ActionResult> {
  try {
    const user = await assertUser("vouchers.delete");
    const db = await getDb();
    await deleteVoucher(db, user.firmId, id, user.id, await clientIp());
    await notifyTransaction(db, user.firmId, user.id, id, "deleted");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreVoucherAction(id: number): Promise<ActionResult<{ number: string; path: string }>> {
  try {
    const user = await assertUser("vouchers.restore");
    const db = await getDb();
    const r = await restoreVoucher(db, user.firmId, id, user.id, await clientIp());
    revalidatePath("/", "layout");
    return { ok: true, number: r.number, path: VOUCHER_INFO[r.type].path };
  } catch (e) {
    return fail(e);
  }
}

export async function openBillsAction(partyId: number, type: VoucherInput["type"], excludeVoucherId?: number) {
  const user = await assertUser();
  const types = SETTLES[type];
  if (!types) return { bills: [], balancePaise: 0 };
  const db = await getDb();
  const [own] = await db.select({ id: parties.id }).from(parties).where(and(eq(parties.id, partyId), eq(parties.firmId, user.firmId)));
  if (!own) return { bills: [], balancePaise: 0 };
  const bills = await openBills(db, partyId, types, excludeVoucherId);
  const [bal] = await db
    .select({ b: sql<number>`coalesce(sum(${partyLedger.amountPaise}), 0)::bigint` })
    .from(partyLedger)
    .where(and(eq(partyLedger.partyId, partyId), excludeVoucherId ? sql`coalesce(${partyLedger.voucherId}, 0) <> ${excludeVoucherId}` : sql`true`));
  return {
    bills: bills.map((b) => ({ id: b.id, type: b.type, number: `${b.prefix}${b.number}`, date: b.date, dueDate: b.dueDate, totalPaise: b.totalPaise, balancePaise: b.balancePaise })),
    balancePaise: can(user, "see.partyBalance") ? Number(bal.b) : 0,
  };
}

export async function quickPartyAction(input: {
  name: string;
  phone?: string;
  gstin?: string;
  stateCode?: string;
  billingAddress?: string;
  kind: "customer" | "supplier" | "both";
}): Promise<ActionResult<{ party: { id: number; name: string; phone: string | null; gstin: string | null; stateCode: string | null; billingAddress: string | null; shippingAddress: string | null; kind: string; creditDays: number | null; priceListId: number | null; balancePaise: number } }>> {
  try {
    const user = await assertUser("masters.edit");
    const db = await getDb();
    const id = await saveParty(db, user.firmId, { ...input, openingBalancePaise: 0 }, user.id);
    const [p] = await db.select().from(parties).where(and(eq(parties.id, id), eq(parties.firmId, user.firmId)));
    revalidatePath("/parties");
    return {
      ok: true,
      party: { id: p.id, name: p.name, phone: p.phone, gstin: p.gstin, stateCode: p.stateCode, billingAddress: p.billingAddress, shippingAddress: p.shippingAddress, kind: p.kind, creditDays: p.creditDays, priceListId: p.priceListId, balancePaise: 0 },
    };
  } catch (e) {
    return fail(e);
  }
}

/** Link anyone can open (no login) to view and download one invoice, valid for 90 days. */
export async function shareLinkAction(voucherId: number): Promise<ActionResult<{ url: string }>> {
  try {
    const user = await assertUser();
    const db = await getDb();
    const [own] = await db.select({ id: vouchers.id }).from(vouchers).where(and(eq(vouchers.id, voucherId), eq(vouchers.firmId, user.firmId)));
    if (!own) return { ok: false, error: "This entry no longer exists." };
    const [existing] = await db
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.voucherId, voucherId), gt(shareLinks.expiresAt, new Date(Date.now() + 7 * 86400_000))));
    let token = existing?.token;
    if (!token) {
      token = randomBytes(18).toString("base64url");
      await db.insert(shareLinks).values({ token, voucherId, expiresAt: new Date(Date.now() + 90 * 86400_000) });
    }
    const base = process.env.APP_URL ?? "http://localhost:3000";
    return { ok: true, url: `${base}/share/${token}` };
  } catch (e) {
    return fail(e);
  }
}

/** Sends a bill to the party: automatically by WhatsApp or email when connected, otherwise as a ready-to-send WhatsApp link. */
export async function sendVoucherAction(voucherId: number): Promise<ActionResult<{ mode: "sent" | "queued" | "manual"; link?: string; to: string }>> {
  try {
    const user = await assertUser();
    const db = await getDb();
    const data = await getVoucher(db, user.firmId, voucherId);
    if (!data) return { ok: false, error: "This entry no longer exists." };
    const v = data.voucher;
    const [party] = v.partyId ? await db.select().from(parties).where(and(eq(parties.id, v.partyId), eq(parties.firmId, user.firmId))) : [];
    const target = partyChannel(user.firm.country, { phone: v.partyPhone ?? party?.phone ?? null, email: party?.email ?? null });
    if (!target) return { ok: false, error: "This customer has no phone number or email on file. Add one on the party first." };

    let [link] = await db.select().from(shareLinks).where(and(eq(shareLinks.voucherId, voucherId), gt(shareLinks.expiresAt, new Date(Date.now() + 7 * 86400_000))));
    if (!link) {
      const token = randomBytes(18).toString("base64url");
      [link] = await db.insert(shareLinks).values({ token, voucherId, expiresAt: new Date(Date.now() + 90 * 86400_000) }).returning();
    }
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const info = VOUCHER_INFO[v.type];
    const text = `${user.firm.name}: ${info.label} ${v.prefix}${v.number} dated ${formatDate(v.date)} for ${formatMoney(v.totalPaise)}${data.balancePaise > 0 ? ` (balance due ${formatMoney(data.balancePaise)})` : ""}.\n\nView / download: ${base}/share/${link.token}`;
    const id = await enqueue(db, user.firmId, {
      kind: "manual",
      channel: target.channel,
      toAddress: target.toAddress,
      toName: v.partyName,
      subject: `${info.label} ${v.prefix}${v.number} from ${user.firm.name}`,
      body: text,
      dedupeKey: `send:${voucherId}:${Math.floor(Date.now() / 60_000)}`,
      partyId: v.partyId ?? undefined,
      refType: "voucher",
      refId: voucherId,
    });
    if (target.channel === "whatsapp" && !channelStatus().whatsappApi) return { ok: true, mode: "manual", link: whatsappLink(target.toAddress, text), to: target.toAddress };
    await processOutbox(db, { limit: 5 });
    const [m] = id ? await db.select({ status: notifications.status }).from(notifications).where(eq(notifications.id, id)) : [];
    return { ok: true, mode: m?.status === "sent" ? "sent" : "queued", to: target.toAddress };
  } catch (e) {
    return fail(e);
  }
}
