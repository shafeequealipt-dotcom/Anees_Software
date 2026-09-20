import { and, asc, eq } from "drizzle-orm";
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
  const [item] = await db.select().from(items).where(and(eq(items.id, Number(id) || 0), eq(items.firmId, user.firmId)));
  if (!item) notFound();
  const [categories, unitList, taxList] = await Promise.all([
    db.select().from(itemCategories).where(eq(itemCategories.firmId, user.firmId)).orderBy(asc(itemCategories.name)),
    db.select().from(units).where(and(eq(units.firmId, user.firmId), eq(units.active, true))).orderBy(asc(units.name)),
    db.select().from(taxRates).where(and(eq(taxRates.firmId, user.firmId), eq(taxRates.active, true))).orderBy(asc(taxRates.sort)),
  ]);
  return (
    <>
      <PageHeader title={`Edit ${item.name}`} back={{ href: `/items/${item.id}`, label: item.name }} />
      <ItemForm initial={hidePurchase ? { ...item, purchasePricePaise: 0 } : item} hidePurchase={hidePurchase} categories={categories} units={unitList} taxRates={taxList} />
    </>
  );
}
