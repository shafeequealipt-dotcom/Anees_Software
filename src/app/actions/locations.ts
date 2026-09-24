"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getDb } from "@/db";
import { AuthError, assertUser } from "@/lib/auth";
import { MasterError } from "@/server/errors";
import { locationSchema, saveLocation, setLocationActive } from "@/server/locations";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was saved — please try again." };
}

export async function saveLocationAction(input: z.input<typeof locationSchema>): Promise<Result<{ id: number }>> {
  try {
    const user = await assertUser("settings.edit");
    const id = await saveLocation(await getDb(), user.firmId, input);
    revalidatePath("/settings/locations");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function setLocationActiveAction(id: number, active: boolean): Promise<Result> {
  try {
    const user = await assertUser("settings.edit");
    await setLocationActive(await getDb(), user.firmId, id, active);
    revalidatePath("/settings/locations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
