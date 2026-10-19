"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { AuthError, assertUser } from "@/lib/auth";
import { createApiKey, revokeApiKey } from "@/server/api-keys";
import { MasterError } from "@/server/errors";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
}

/** Makes a key and returns it once; it can't be shown again. */
export async function createApiKeyAction(name: string, firmId: number): Promise<Result<{ token: string }>> {
  try {
    const user = await assertUser("api.manage");
    if (!user.isOwner && !user.firms.some((f) => f.id === firmId)) throw new AuthError("You can only make keys for companies you can open.");
    const { token } = await createApiKey(await getDb(), firmId, name, user.id);
    revalidatePath("/settings/api-keys");
    return { ok: true, token };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiKeyAction(id: number): Promise<Result> {
  try {
    const user = await assertUser("api.manage");
    await revokeApiKey(await getDb(), id, user.isOwner ? "all" : user.firms.map((f) => f.id), user.id);
    revalidatePath("/settings/api-keys");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
