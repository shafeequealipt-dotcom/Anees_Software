"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { AuthError, assertUser } from "@/lib/auth";
import { MasterError } from "@/server/errors";
import { disconnectTelegram, makeLinkCode, saveTelegramConfig, setLinkCompany, setTelegramEnabled, unlinkTelegram } from "@/server/telegram/config";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

function fail(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof MasterError) return { ok: false, error: e.message, field: e.field };
  if (e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was changed — please try again." };
}

/** Everything about the Telegram bot is the Owner's alone. */
async function owner() {
  const user = await assertUser("companies.manage");
  if (!user.isOwner) throw new AuthError("Only the Owner can set up Telegram.");
  return user;
}

const done = () => revalidatePath("/settings/telegram");

/** Blank fields keep what's stored; the secrets are never sent back to the browser. */
export async function saveTelegramAction(input: { botToken: string; aiKey: string; model: string; textModel: string; readMode: string }): Promise<Result> {
  try {
    const user = await owner();
    await saveTelegramConfig(await getDb(), input, user.id, process.env.APP_URL ?? "http://localhost:3000");
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectTelegramAction(): Promise<Result> {
  try {
    const user = await owner();
    await disconnectTelegram(await getDb(), user.id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setTelegramEnabledAction(firmId: number, enabled: boolean): Promise<Result> {
  try {
    const user = await owner();
    await setTelegramEnabled(await getDb(), firmId, enabled, user.id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** A one-time link (10 minutes) that opens the bot and links this Telegram account to `firmId`. */
export async function linkTelegramAction(firmId: number): Promise<Result<{ url: string; code: string }>> {
  try {
    const user = await owner();
    const { url, code } = await makeLinkCode(await getDb(), user.id, firmId);
    return { ok: true, url, code };
  } catch (e) {
    return fail(e);
  }
}

export async function unlinkTelegramAction(id: number): Promise<Result> {
  try {
    const user = await owner();
    await unlinkTelegram(await getDb(), id, user.id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setLinkCompanyAction(linkId: number, firmId: number): Promise<Result> {
  try {
    await owner();
    await setLinkCompany(await getDb(), { linkId }, firmId);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
