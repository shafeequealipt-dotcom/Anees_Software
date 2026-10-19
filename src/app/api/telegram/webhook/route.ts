import { after } from "next/server";
import { getDb } from "@/db";
import type { TgUpdate } from "@/server/telegram/bot";
import { webhookSecretMatches } from "@/server/telegram/config";
import { firstDelivery, handleUpdate } from "@/server/telegram/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Telegram delivers the bot's messages and button taps here, with the secret it was given when the bot was
 * connected. We answer at once and do the work afterwards, so a slow bill reading never makes Telegram resend.
 */
export async function POST(req: Request) {
  const db = await getDb();
  if (!(await webhookSecretMatches(db, req.headers.get("x-telegram-bot-api-secret-token")))) return new Response("Forbidden", { status: 403 });
  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (typeof update?.update_id !== "number") return new Response("Bad request", { status: 400 });
  if (await firstDelivery(db, update.update_id)) after(() => handleUpdate(db, update));
  return Response.json({ ok: true });
}
