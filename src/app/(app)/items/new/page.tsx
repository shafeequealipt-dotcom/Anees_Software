import { asc, eq } from "drizzle-orm";
import { ItemForm } from "@/components/item-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { itemCategories, taxRates, units } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Add item" };

export default async function NewItemPage() {
  await requireUser("masters.edit");
  const db = await getDb();
  const [categories, unitList, taxList] = await Promise.all([
    db.select().from(itemCategories).orderBy(asc(itemCategories.name)),
    db.select().from(units).where(eq(units.active, true)).orderBy(asc(units.name)),
    db.select().from(taxRates).where(eq(taxRates.active, true)).orderBy(asc(taxRates.sort)),
  ]);
  return (
    <>
      <PageHeader title="Add item" back={{ href: "/items", label: "Items & stock" }} />
      <ItemForm categories={categories} units={unitList} taxRates={taxList} />
    </>
  );
}
