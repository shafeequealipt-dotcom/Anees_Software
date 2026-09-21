import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { itemCategories, ledgerCategories } from "@/db/schema";
import { audit } from "@/lib/audit";
import { MasterError } from "./masters";

export type CategoryKind = "item" | "expense" | "income";

export interface CategoryRow {
  id: number;
  name: string;
  used: number;
}

export async function listAllCategories(db: DB, firmId: number): Promise<Record<CategoryKind, CategoryRow[]>> {
  const item = await db
    .select({ id: itemCategories.id, name: itemCategories.name, used: sql<number>`(select count(*)::int from items i where i.category_id = "item_categories"."id")` })
    .from(itemCategories)
    .where(eq(itemCategories.firmId, firmId))
    .orderBy(asc(itemCategories.name));
  const led = await db
    .select({ id: ledgerCategories.id, name: ledgerCategories.name, kind: ledgerCategories.kind, used: sql<number>`(select count(*)::int from vouchers v where v.category_id = "ledger_categories"."id")` })
    .from(ledgerCategories)
    .where(eq(ledgerCategories.firmId, firmId))
    .orderBy(asc(ledgerCategories.name));
  return { item, expense: led.filter((c) => c.kind === "expense"), income: led.filter((c) => c.kind === "income") };
}

/** Adds a category, or renames one when `id` is given. Names are unique within their kind. */
export async function saveCategoryName(db: DB, firmId: number, kind: CategoryKind, id: number | undefined, rawName: string, userId: number) {
  const name = rawName.trim();
  if (!name) throw new MasterError("Enter a name.");
  if (name.length > 120) throw new MasterError("Keep the name under 120 characters.");
  const existing = await listAllCategories(db, firmId);
  if (existing[kind].some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) throw new MasterError("A category with this name already exists.");
  if (kind === "item") {
    if (id) {
      const r = await db.update(itemCategories).set({ name }).where(and(eq(itemCategories.id, id), eq(itemCategories.firmId, firmId))).returning({ id: itemCategories.id });
      if (!r.length) throw new MasterError("This category no longer exists.");
    } else await db.insert(itemCategories).values({ firmId, name });
  } else if (id) {
    const r = await db.update(ledgerCategories).set({ name }).where(and(eq(ledgerCategories.id, id), eq(ledgerCategories.firmId, firmId), eq(ledgerCategories.kind, kind))).returning({ id: ledgerCategories.id });
    if (!r.length) throw new MasterError("This category no longer exists.");
  } else await db.insert(ledgerCategories).values({ firmId, kind, name });
  await audit(db, { firmId, userId, action: id ? "update" : "create", entity: "category", entityId: id ?? null, summary: `${id ? "Renamed" : "Added"} ${kind} category ${name}` });
}

/** Deletes a category nobody uses. One that is in use has to be emptied first, so bills never lose their category. */
export async function deleteCategory(db: DB, firmId: number, kind: CategoryKind, id: number, userId: number) {
  const list = (await listAllCategories(db, firmId))[kind];
  const c = list.find((x) => x.id === id);
  if (!c) return;
  if (c.used > 0) throw new MasterError(`"${c.name}" is used on ${c.used} ${kind === "item" ? "item" : "bill"}${c.used === 1 ? "" : "s"}, so it can't be deleted. Move them to another category first.`);
  if (kind === "item") await db.delete(itemCategories).where(and(eq(itemCategories.id, id), eq(itemCategories.firmId, firmId)));
  else await db.delete(ledgerCategories).where(and(eq(ledgerCategories.id, id), eq(ledgerCategories.firmId, firmId)));
  await audit(db, { firmId, userId, action: "delete", entity: "category", entityId: id, summary: `Deleted ${kind} category ${c.name}` });
}
