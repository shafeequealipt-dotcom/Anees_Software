import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { activeFirms, processOutbox } from "@/server/notify/outbox";
import { runPaymentReminders } from "@/server/notify/reminders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Called every few minutes by a timer on the server (see deploy/server/systemd/billing-notify.*). Needs the CRON_SECRET header. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Scheduled jobs are not enabled.", { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return new Response("Forbidden", { status: 403 });

  const db = await getDb();
  const reminders: Record<string, { queued: number }> = {};
  for (const f of await activeFirms(db)) {
    try {
      reminders[f.name] = await runPaymentReminders(db, f.id);
    } catch (e) {
      console.error("reminders failed for", f.name, e);
    }
  }
  const sent = await processOutbox(db);
  return Response.json({ reminders, ...sent });
}
