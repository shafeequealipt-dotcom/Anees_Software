import { and, asc, eq } from "drizzle-orm";
import { ItemForm } from "@/components/item-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { itemCategories, taxRates, units } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Add item" };

export default async function NewItemPage() {
  const user = await requireUser("masters.edit");
  const db = await getDb();
  const [categories, unitList, taxList] = await Promise.all([
    db.select().from(itemCategories).where(eq(itemCategories.firmId, user.firmId)).orderBy(asc(itemCategories.name)),
    db.select().from(units).where(and(eq(units.firmId, user.firmId), eq(units.active, true))).orderBy(asc(units.name)),
    db.select().from(taxRates).where(and(eq(taxRates.firmId, user.firmId), eq(taxRates.active, true))).orderBy(asc(taxRates.sort)),
  ]);
  return (
    <>
      <PageHeader title="Add item" back={{ href: "/items", label: "Items & stock" }} />
      <ItemForm categories={categories} units={unitList} taxRates={taxList} />
    </>
  );
}
