import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { LinkSelect, SearchBox, Tabs } from "@/components/simple-filters";
import { Badge, Empty, LinkButton, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { itemCategories } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatQty } from "@/lib/money";
import { stockSummary } from "@/server/reports";

export const metadata = { title: "Items & stock" };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; category?: string }> }) {
  const user = await requireUser();
  const seeValue = can(user, "see.stockValue");
  const sp = await searchParams;
  const db = await getDb();
  const categories = await db.select().from(itemCategories).where(eq(itemCategories.firmId, user.firmId)).orderBy(asc(itemCategories.name));
  const list = await stockSummary(db, user.firmId, {
    q: sp.q,
    categoryId: sp.category ? Number(sp.category) : undefined,
    lowOnly: sp.show === "low",
    includeInactive: sp.show === "inactive",
  });
  const shown = sp.show === "inactive" ? list.filter((i) => !i.active) : list;
  const stockValue = shown.reduce((s, i) => s + i.stock_value_paise, 0);
  const lowCount = list.filter((i) => i.low).length;

  return (
    <>
      <PageHeader
        title="Items & stock"
        actions={
          <>
            <LinkButton href="/items/import">Import / bulk update</LinkButton>
            <a href="/api/export/items" className="inline-flex h-9 items-center rounded-md border border-line bg-panel px-3.5 text-sm font-medium hover:bg-ground">Export</a>
            <LinkButton href="/items/new" variant="primary">+ Add item</LinkButton>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="show"
          current={sp.show ?? "all"}
          options={[
            { value: "all", label: "All" },
            { value: "low", label: `Low stock${lowCount ? ` (${lowCount})` : ""}` },
            { value: "inactive", label: "Inactive" },
          ]}
        />
        {categories.length > 0 && (
          <LinkSelect
            param="category"
            ariaLabel="Category"
            current={sp.category ?? ""}
            options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
        )}
        <SearchBox q={sp.q} placeholder="Name or item code" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg border border-line bg-panel px-3 py-2">
          <div className="text-xs text-muted">Items shown</div>
          <div className="font-semibold">{shown.length}</div>
        </div>
        {seeValue && (
          <div className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-xs text-muted">Stock value (at cost)</div>
            <Money paise={stockValue} className="font-semibold" />
          </div>
        )}
      </div>
      <Panel padded={false}>
        {shown.length === 0 ? (
          <Empty title={sp.q ? `No item matches “${sp.q}”` : "No items yet"} action={<LinkButton href="/items/new" variant="primary">+ Add item</LinkButton>}>
            Add your products and services, or import them from an Excel sheet.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Category</th>
                <th className={th + " text-right"}>Sale price</th>
                <th className={th + " text-right"}>Stock</th>
                {seeValue && <th className={th + " text-right"}>Stock value</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="hover:bg-ground/60">
                  <td className={td}>
                    <Link href={`/items/${i.id}`} className="font-medium text-brand-600 hover:underline">
                      {i.name}
                    </Link>
                    <div className="text-xs text-faint">
                      {i.code}
                      {!i.active && (
                        <>
                          {" "}
                          <Badge>Inactive</Badge>
                        </>
                      )}
                    </div>
                  </td>
                  <td className={td}>{i.category_name}</td>
                  <td className={td + " text-right"}>
                    <Money paise={i.sale_price_paise} />
                  </td>
                  <td className={td + " text-right"}>
                    <span className={i.low ? "font-medium text-warn" : ""}>
                      {formatQty(i.qty_milli)} {i.unit_code}
                    </span>
                    {i.low && (
                      <div>
                        <Badge tone="warn">Low</Badge>
                      </div>
                    )}
                  </td>
                  {seeValue && (
                    <td className={td + " text-right"}>
                      <Money paise={i.stock_value_paise} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
