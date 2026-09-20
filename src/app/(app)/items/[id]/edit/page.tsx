import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ItemForm } from "@/components/item-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { itemCategories, items, taxRates, units } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("masters.edit");
  const hidePurchase = !can(user, "see.purchasePrice");
  const { id } = await params;
  const db = await getDb();
  const [item] = await db.select().from(items).where(eq(items.id, Number(id) || 0));
  if (!item) notFound();
  const [categories, unitList, taxList] = await Promise.all([
    db.select().from(itemCategories).orderBy(asc(itemCategories.name)),
    db.select().from(units).where(eq(units.active, true)).orderBy(asc(units.name)),
    db.select().from(taxRates).where(eq(taxRates.active, true)).orderBy(asc(taxRates.sort)),
  ]);
  return (
    <>
      <PageHeader title={`Edit ${item.name}`} back={{ href: `/items/${item.id}`, label: item.name }} />
      <ItemForm initial={hidePurchase ? { ...item, purchasePricePaise: 0 } : item} hidePurchase={hidePurchase} categories={categories} units={unitList} taxRates={taxList} />
    </>
  );
}
