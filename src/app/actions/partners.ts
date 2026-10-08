"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getDb } from "@/db";
import { AuthError, assertUser } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { MasterError } from "@/server/errors";
import {
  addPromotion,
  createPayoutLink,
  type invoiceSchema,
  loadPayoutInvoice,
  type partnerSchema,
  type payoutSettingsSchema,
  type payPartnerSchema,
  payPartner,
  payoutMessage,
  type promotionSchema,
  removePromotion,
  savePartner,
  savePayoutInvoice,
  savePayoutSettings,
  saveViews,
  setPartnersEnabled,
  suggestInvoiceNo,
  type viewsSchema,
} from "@/server/partners";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
}

const refresh = () => {
  revalidatePath("/partners", "layout");
  revalidatePath("/expenses");
};

export async function savePartnerAction(input: z.input<typeof partnerSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("partners.manage");
    const id = await savePartner(await getDb(), user.firmId, input, user.id);
    refresh();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function saveViewsAction(input: z.input<typeof viewsSchema>): Promise<Result> {
  try {
    const user = await assertUser("partners.manage");
    await saveViews(await getDb(), user.firmId, input, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addPromotionAction(input: z.input<typeof promotionSchema>): Promise<Result> {
  try {
    const user = await assertUser("partners.manage");
    await addPromotion(await getDb(), user.firmId, input, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removePromotionAction(id: number): Promise<Result> {
  try {
    const user = await assertUser("partners.manage");
    await removePromotion(await getDb(), user.firmId, id, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function payPartnerAction(input: z.input<typeof payPartnerSchema>): Promise<Result<{ id: number; number: string }>> {
  try {
    const user = await assertUser("partners.manage");
    const r = await payPartner(await getDb(), user.firmId, input, user.id);
    refresh();
    return { ok: true, id: r.id, number: r.number };
  } catch (e) {
    return fail(e);
  }
}

/** The number a new invoice dated `date` would get, for the invoice form. */
export async function suggestInvoiceNoAction(date: string): Promise<Result<{ invoiceNo: string }>> {
  try {
    const user = await assertUser("partners.manage");
    return { ok: true, invoiceNo: await suggestInvoiceNo(await getDb(), user.firmId, date) };
  } catch (e) {
    return fail(e);
  }
}

export async function savePayoutInvoiceAction(input: z.input<typeof invoiceSchema>): Promise<Result<{ payoutId: number; invoiceNo: string }>> {
  try {
    const user = await assertUser("partners.manage");
    const r = await savePayoutInvoice(await getDb(), user.firmId, input, user.id);
    refresh();
    return { ok: true, payoutId: r.payoutId, invoiceNo: r.invoiceNo };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Makes the private link for an invoice and the ready-to-send WhatsApp message. `web` opens WhatsApp Web
 * on the partner's chat (or lets the owner pick a chat when no number is saved); `text` is for the phone's share sheet.
 */
export async function shareInvoiceAction(payoutId: number): Promise<Result<{ web: string; text: string; url: string; pdfUrl: string; hasPhone: boolean }>> {
  try {
    const user = await assertUser("partners.manage");
    const db = await getDb();
    const token = await createPayoutLink(db, user.firmId, payoutId, user.id);
    const inv = await loadPayoutInvoice(db, user.firmId, payoutId);
    if (!inv) throw new MasterError("Make the invoice first.");
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const url = `${base}/api/share/payout/${token}/pdf`;
    const text = payoutMessage({ companyName: inv.model.company.name, invoiceNo: inv.model.invoiceNo, period: inv.model.period, totalPaise: inv.model.totalPaise }, url);
    const phone = normalizePhone(inv.phone, "IN");
    const web = `https://web.whatsapp.com/send?${phone ? `phone=${phone}&` : ""}text=${encodeURIComponent(text)}`;
    return { ok: true, web, text, url, pdfUrl: `/api/partners/payouts/${payoutId}/pdf`, hasPhone: !!phone };
  } catch (e) {
    return fail(e);
  }
}

export async function savePayoutSettingsAction(input: z.input<typeof payoutSettingsSchema>): Promise<Result> {
  try {
    const user = await assertUser("partners.manage");
    await savePayoutSettings(await getDb(), user.firmId, input, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Owner only: turn Partners on or off for one company. */
export async function setPartnersEnabledAction(firmId: number, enabled: boolean): Promise<Result> {
  try {
    const user = await assertUser("companies.manage");
    if (!user.isOwner) throw new AuthError("Only the Owner can turn Partners on or off.");
    await setPartnersEnabled(await getDb(), firmId, enabled, user.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
