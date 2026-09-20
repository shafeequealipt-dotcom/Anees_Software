"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getDb } from "@/db";
import { AuthError, assertUser } from "@/lib/auth";
import { deleteJournal, disposeAsset, type assetSchema, type glAccountSchema, type journalSchema, postJournal, rebuildGl, runDepreciation, saveAsset, saveGlAccount } from "@/server/gl";
import { MasterError } from "@/server/masters";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
}

export async function saveGlAccountAction(input: z.input<typeof glAccountSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("accounting.edit");
    const id = await saveGlAccount(await getDb(), user.firmId, input, user.id);
    revalidatePath("/accounting", "layout");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function postJournalAction(input: z.input<typeof journalSchema>): Promise<Result<{ number: number }>> {
  try {
    const user = await assertUser("accounting.edit");
    const r = await postJournal(await getDb(), user.firmId, input, user.id);
    revalidatePath("/accounting", "layout");
    return { ok: true, number: r.number };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteJournalAction(id: number): Promise<Result> {
  try {
    const user = await assertUser("accounting.edit");
    await deleteJournal(await getDb(), user.firmId, id, user.id);
    revalidatePath("/accounting", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveAssetAction(input: z.input<typeof assetSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("accounting.edit");
    const id = await saveAsset(await getDb(), user.firmId, input, user.id);
    revalidatePath("/accounting", "layout");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function runDepreciationAction(fyFrom: string): Promise<Result<{ posted: number }>> {
  try {
    const user = await assertUser("accounting.edit");
    const posted = await runDepreciation(await getDb(), user.firmId, fyFrom, user.id);
    revalidatePath("/accounting", "layout");
    return { ok: true, posted };
  } catch (e) {
    return fail(e);
  }
}

export async function disposeAssetAction(id: number, input: { date: string; proceedsPaise: number; accountId: number | null }): Promise<Result> {
  try {
    const user = await assertUser("accounting.edit");
    await disposeAsset(await getDb(), user.firmId, id, input, user.id);
    revalidatePath("/accounting", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function rebuildBooksAction(): Promise<Result> {
  try {
    const user = await assertUser("accounting.edit");
    await rebuildGl(await getDb(), user.firmId);
    revalidatePath("/accounting", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
