import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { telegramDrafts, telegramFiles } from "@/db/schema";
import { canSeeVoucher, currentUser } from "@/lib/auth";
import { getVoucher } from "@/server/vouchers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A photo or PDF of a bill as it was sent to the Telegram bot, for anyone who can see the bill it became. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || user.firmId === 0 || user.mustChangePassword) return new Response("Please sign in.", { status: 401 });
  const id = Number((await ctx.params).id);
  if (!id) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [f] = await db
    .select({ mime: telegramFiles.mime, data: telegramFiles.data, voucherId: telegramDrafts.voucherId })
    .from(telegramFiles)
    .innerJoin(telegramDrafts, eq(telegramDrafts.id, telegramFiles.draftId))
    .where(and(eq(telegramFiles.id, id), eq(telegramDrafts.firmId, user.firmId)));
  if (!f?.data || !f.voucherId) return new Response("Not found", { status: 404 });
  const v = await getVoucher(db, user.firmId, f.voucherId);
  if (!v || !canSeeVoucher(user, v.voucher)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="bill-${id}.${f.mime === "application/pdf" ? "pdf" : f.mime.split("/")[1]}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
