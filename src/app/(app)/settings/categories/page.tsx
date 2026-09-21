import { CategoryManager } from "@/components/category-manager";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listAllCategories } from "@/server/categories";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const user = await requireUser("settings.edit");
  const all = await listAllCategories(await getDb(), user.firmId);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <CategoryManager kind="item" title="Item categories" hint="Group your items, e.g. Stationery, Grocery." rows={all.item} />
      <CategoryManager kind="expense" title="Expense categories" hint="Used when you record an expense, e.g. Rent, Salaries." rows={all.expense} />
      <CategoryManager kind="income" title="Other-income categories" hint="Used for income that isn't a sale, e.g. Interest received." rows={all.income} />
    </div>
  );
}
