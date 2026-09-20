"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AuthError, assertUser, clientIp, currentUser, hashPassword, passwordProblem, switchCompany, verifyPassword } from "@/lib/auth";
import { createCompany, createUser, deleteRole, editUserSchema, firmSchema, newUserSchema, resetUserPassword, roleSchema, saveFirm, saveRole, setCompanyActive, updateUser } from "@/server/admin";
import { MasterError } from "@/server/masters";
import type { companySchema } from "@/server/setup";
import { type customFieldSchema, saveCustomField } from "@/server/custom-fields";
import { type partyRatesSchema, type priceListSchema, savePriceList, setItemPrices, setPartyRates } from "@/server/pricing";
import { type preferencesSchema, savePreferences } from "@/server/preferences";
import { markServiceDone } from "@/server/notify/service";
import { markMessage } from "@/server/notify/outbox";
import { type messagingSchema, saveMessagingSettings } from "@/server/notify/settings";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
}

export async function saveFirmAction(input: z.input<typeof firmSchema>): Promise<Result> {
  try {
    const user = await assertUser("settings.edit");
    await saveFirm(await getDb(), user.firmId, input, user.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createUserAction(input: z.input<typeof newUserSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("users.manage");
    const id = await createUser(await getDb(), input, user.id);
    revalidatePath("/settings/users");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function updateUserAction(input: z.input<typeof editUserSchema>): Promise<Result> {
  try {
    const user = await assertUser("users.manage");
    await updateUser(await getDb(), input, user.id);
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resetPasswordAction(id: number, password: string): Promise<Result> {
  try {
    const user = await assertUser("users.manage");
    await resetUserPassword(await getDb(), id, password, user.id);
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveRoleAction(input: z.input<typeof roleSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("users.manage");
    const id = await saveRole(await getDb(), input, user.id);
    revalidatePath("/settings/roles");
    revalidatePath("/settings/users");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRoleAction(id: number): Promise<Result> {
  try {
    const user = await assertUser("users.manage");
    await deleteRole(await getDb(), id, user.id);
    revalidatePath("/settings/roles");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Own password. Works even while a temporary password is still in force. */
export async function changeOwnPasswordAction(current: string, next: string): Promise<Result> {
  try {
    const user = await currentUser();
    if (!user) throw new AuthError("Your session has ended. Sign in again.");
    const db = await getDb();
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    if (!row || !(await verifyPassword(row.passwordHash, current))) return { ok: false, error: "The current password isn't right.", field: "current" };
    if (current === next) return { ok: false, error: "Choose a password different from the current one.", field: "next" };
    const weak = passwordProblem(next);
    if (weak) return { ok: false, error: weak, field: "next" };
    await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, user.id));
    await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, user.sessionId)));
    await audit(db, { userId: user.id, action: "update", entity: "user", entityId: user.id, summary: `${user.name} changed their password`, ip: await clientIp() });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function switchCompanyAction(firmId: number): Promise<Result> {
  try {
    await switchCompany(firmId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createCompanyAction(input: z.input<typeof companySchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("companies.manage");
    const id = await createCompany(await getDb(), input, user.id);
    revalidatePath("/settings/companies");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function setCompanyActiveAction(firmId: number, active: boolean): Promise<Result> {
  try {
    const user = await assertUser("companies.manage");
    await setCompanyActive(await getDb(), firmId, active, user.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveMessagingSettingsAction(input: z.input<typeof messagingSchema>): Promise<Result> {
  try {
    const user = await assertUser("settings.edit");
    await saveMessagingSettings(await getDb(), user.firmId, input, user.id);
    revalidatePath("/settings/messaging");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function messageAction(id: number, action: "sent" | "retry" | "cancel"): Promise<Result> {
  try {
    const user = await assertUser("settings.edit");
    await markMessage(await getDb(), user.firmId, id, action);
    revalidatePath("/settings/messaging");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function savePreferencesAction(input: z.input<typeof preferencesSchema>): Promise<Result> {
  try {
    const user = await assertUser("settings.edit");
    await savePreferences(await getDb(), user.firmId, input, user.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function savePriceListAction(input: z.input<typeof priceListSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("settings.edit");
    const id = await savePriceList(await getDb(), user.firmId, input);
    revalidatePath("/settings/price-lists");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function setItemPricesAction(itemId: number, prices: { priceListId: number; salePricePaise: number | null; includesTax: boolean }[]): Promise<Result> {
  try {
    const user = await assertUser("masters.edit");
    await setItemPrices(await getDb(), user.firmId, itemId, prices, user.id);
    revalidatePath(`/items/${itemId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPartyRatesAction(partyId: number, rates: z.input<typeof partyRatesSchema>): Promise<Result> {
  try {
    const user = await assertUser("masters.edit");
    await setPartyRates(await getDb(), user.firmId, partyId, rates, user.id);
    revalidatePath(`/parties/${partyId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveCustomFieldAction(input: z.input<typeof customFieldSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("settings.edit");
    const id = await saveCustomField(await getDb(), user.firmId, input);
    revalidatePath("/settings/custom-fields");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function markServiceDoneAction(id: number): Promise<Result> {
  try {
    const user = await assertUser("masters.edit");
    await markServiceDone(await getDb(), user.firmId, id);
    revalidatePath("/services");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
