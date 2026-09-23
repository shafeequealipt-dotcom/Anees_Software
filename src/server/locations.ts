import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { locations } from "@/db/schema";

/**
 * The location new activity defaults into when nothing is chosen explicitly (e.g. an older client
 * that doesn't send a shop, or a single-location company): the firm's first active location of the
 * preferred kind, or its first active location of any kind if none matches that kind.
 */
export async function defaultLocationId(tx: Tx, firmId: number, prefer: "shop" | "warehouse" = "shop"): Promise<number | null> {
  const [loc] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.firmId, firmId), eq(locations.active, true)))
    .orderBy(sql`(${locations.kind} <> ${prefer})`, asc(locations.sort), asc(locations.id))
    .limit(1);
  return loc?.id ?? null;
}
