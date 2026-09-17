"use server";

import { randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { parties, partyLedger, shareLinks, vouchers } from "@/db/schema";
import { AuthError, assertUser, clientIp } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { SETTLES, VOUCHER_INFO } from "@/lib/voucher-types";
import { MasterError, saveParty } from "@/server/masters";
import { cancelVoucher, deleteVoucher, openBills, saveVoucher, VoucherError, type VoucherInput } from "@/server/vouchers";

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
    if (["money_adjustment", "money_transfer", "other_income"].includes(input.type) && !can(user.role, "money.edit")) {
      throw new AuthError("You don't have permission to record this.");
    }
    const db = await getDb();
    if (input.id && !can(user.role, "vouchers.editOld")) {
      const [v] = await db.select({ createdAt: vouchers.createdAt }).from(vouchers).where(eq(vouchers.id, input.id));
      const created = v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(v.createdAt) : null;
      if (created && created !== todayIST()) throw new AuthError("Only the owner or accountant can edit entries from earlier days.");
    }
    const res = await saveVoucher(db, input, user.id, await clientIp());
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
    await cancelVoucher(db, id, user.id, await clientIp());
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
    await deleteVoucher(db, id, user.id, await clientIp());
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function openBillsAction(partyId: number, type: VoucherInput["type"], excludeVoucherId?: number) {
  await assertUser();
  const types = SETTLES[type];
  if (!types) return { bills: [], balancePaise: 0 };
  const db = await getDb();
  const bills = await openBills(db, partyId, types, excludeVoucherId);
  const [bal] = await db
    .select({ b: sql<number>`coalesce(sum(${partyLedger.amountPaise}), 0)::bigint` })
    .from(partyLedger)
    .where(and(eq(partyLedger.partyId, partyId), excludeVoucherId ? sql`coalesce(${partyLedger.voucherId}, 0) <> ${excludeVoucherId}` : sql`true`));
  return {
    bills: bills.map((b) => ({ id: b.id, type: b.type, number: `${b.prefix}${b.number}`, date: b.date, dueDate: b.dueDate, totalPaise: b.totalPaise, balancePaise: b.balancePaise })),
    balancePaise: Number(bal.b),
  };
}

export async function quickPartyAction(input: {
  name: string;
  phone?: string;
  gstin?: string;
  stateCode?: string;
  billingAddress?: string;
  kind: "customer" | "supplier" | "both";
}): Promise<ActionResult<{ party: { id: number; name: string; phone: string | null; gstin: string | null; stateCode: string | null; billingAddress: string | null; shippingAddress: string | null; kind: string; creditDays: number | null; balancePaise: number } }>> {
  try {
    const user = await assertUser("masters.edit");
    const db = await getDb();
    const id = await saveParty(db, { ...input, openingBalancePaise: 0 }, user.id);
    const [p] = await db.select().from(parties).where(eq(parties.id, id));
    revalidatePath("/parties");
    return {
      ok: true,
      party: { id: p.id, name: p.name, phone: p.phone, gstin: p.gstin, stateCode: p.stateCode, billingAddress: p.billingAddress, shippingAddress: p.shippingAddress, kind: p.kind, creditDays: p.creditDays, balancePaise: 0 },
    };
  } catch (e) {
    return fail(e);
  }
}

/** Link anyone can open (no login) to view and download one invoice, valid for 90 days. */
export async function shareLinkAction(voucherId: number): Promise<ActionResult<{ url: string }>> {
  try {
    await assertUser();
    const db = await getDb();
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
