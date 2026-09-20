import "server-only";
import { and, eq, gt, ne } from "drizzle-orm";
import type { DB } from "@/db";
import { shareLinks, vouchers } from "@/db/schema";

/** The invoice a share link points to, or null when the link is unknown or has expired. */
export async function resolveShare(db: DB, token: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const [row] = await db
    .select({ voucherId: shareLinks.voucherId, firmId: vouchers.firmId, status: vouchers.status })
    .from(shareLinks)
    .innerJoin(vouchers, eq(vouchers.id, shareLinks.voucherId))
    .where(and(eq(shareLinks.token, token), gt(shareLinks.expiresAt, new Date()), ne(vouchers.status, "deleted")));
  return row ?? null;
}
