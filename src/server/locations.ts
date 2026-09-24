import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db";
import { locations } from "@/db/schema";
import { MasterError } from "./errors";

/**
 * The location new activity defaults into when nothing is chosen explicitly (e.g. an older client
 * that doesn't send a shop, or a single-location company): the firm's first active location of the
 * preferred kind, or its first active location of any kind if none matches that kind.
 */
export async function defaultLocationId(tx: Tx, firmId: number, prefer: "shop" | "warehouse" = "shop"): Promise<number | null> {
  const [loc] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.firmId, firmId), eq(locations.active, true), sql`${locations.kind} in ('warehouse', 'shop')`))
    .orderBy(sql`(${locations.kind} <> ${prefer})`, asc(locations.sort), asc(locations.id))
    .limit(1);
  return loc?.id ?? null;
}

/** Shops and the warehouse only — not the system-managed transit/damaged locations, which the owner doesn't manage here. */
export async function listLocations(db: DB, firmId: number) {
  return db
    .select({
      id: locations.id,
      firmId: locations.firmId,
      name: locations.name,
      kind: sql<"warehouse" | "shop">`${locations.kind}`,
      code: locations.code,
      address: locations.address,
      phone: locations.phone,
      active: locations.active,
      sort: locations.sort,
      createdAt: locations.createdAt,
    })
    .from(locations)
    .where(and(eq(locations.firmId, firmId), sql`${locations.kind} in ('warehouse', 'shop')`))
    .orderBy(asc(locations.sort), asc(locations.id));
}

/** The firm's one system-managed "in transit" or "damaged goods" location (see schema.ts). */
export async function systemLocationId(db: DB | Tx, firmId: number, kind: "transit" | "damaged"): Promise<number | null> {
  const [loc] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.firmId, firmId), eq(locations.kind, kind), eq(locations.active, true)))
    .limit(1);
  return loc?.id ?? null;
}

const text = (max: number) =>
  z.string().max(max, `Keep this under ${max} characters.`).nullish().transform((v) => (v && v.trim() ? v.trim() : null));

export const locationSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Enter a name for this shop or warehouse.").max(120),
  kind: z.enum(["warehouse", "shop"]).default("shop"),
  code: text(20),
  address: text(1000),
  phone: text(30),
  active: z.boolean().default(true),
});

export async function saveLocation(db: DB, firmId: number, raw: z.input<typeof locationSchema>) {
  const p = locationSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const { id, ...values } = p.data;
  const [dupe] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.firmId, firmId), sql`lower(${locations.name}) = ${values.name.toLowerCase()}`, id ? ne(locations.id, id) : sql`true`));
  if (dupe) throw new MasterError(`A shop or warehouse named "${values.name}" already exists.`, "name");
  if (id) {
    await db.update(locations).set(values).where(and(eq(locations.id, id), eq(locations.firmId, firmId)));
    return id;
  }
  const [row] = await db.insert(locations).values({ ...values, firmId }).returning({ id: locations.id });
  return row.id;
}

/** Hides a location. Refuses if it's the last active one — a firm always needs somewhere to keep stock. */
export async function setLocationActive(db: DB, firmId: number, id: number, active: boolean) {
  if (!active) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(locations)
      .where(and(eq(locations.firmId, firmId), eq(locations.active, true), ne(locations.id, id), sql`${locations.kind} in ('warehouse', 'shop')`));
    if (n === 0) throw new MasterError("A company always needs at least one shop or warehouse.");
  }
  await db.update(locations).set({ active }).where(and(eq(locations.id, id), eq(locations.firmId, firmId)));
}
