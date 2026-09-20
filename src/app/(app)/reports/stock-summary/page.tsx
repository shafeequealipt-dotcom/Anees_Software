import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatQty } from "@/lib/money";
import { stockSummary } from "@/server/reports";

export const metadata = { title: "Stock summary" };

export default async function StockSummaryPage() {
  const user = await requireUser("reports.all");
  const seeValue = can(user, "see.stockValue");
  const db = await getDb();
  const list = await stockSummary(db);
  const totalValue = list.reduce((s, i) => s + i.stock_value_paise, 0);
  const totalQty = list.reduce((s, i) => s + Math.max(0, i.qty_milli), 0);

  return (
    <>
      <PageHeader title="Stock summary" back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg border border-line bg-panel px-3 py-2">
          <div className="text-xs text-muted">Items</div>
          <div className="font-semibold">{list.length}</div>
        </div>
        {seeValue && (
          <div className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-xs text-muted">Total stock value (at cost)</div>
            <Money paise={totalValue} className="font-semibold" />
          </div>
        )}
      </div>
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="No products yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Category</th>
                <th className={th + " text-right"}>Quantity</th>
                {seeValue && <th className={th + " text-right"}>Cost / unit</th>}
                {seeValue && <th className={th + " text-right"}>Value</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className={"hover:bg-ground/60 " + (i.qty_milli < 0 ? "text-bad" : "")}>
                  <td className={td}>
                    <Link href={`/items/${i.id}`} className="font-medium text-brand-600 hover:underline">
                      {i.name}
                    </Link>
                    <div className="text-xs text-faint">{i.code}</div>
                  </td>
                  <td className={td}>{i.category_name}</td>
                  <td className={td + " text-right"}>
                    {formatQty(i.qty_milli)} {i.unit_code}
                  </td>
                  {seeValue && (
                    <td className={td + " text-right"}>
                      <Money paise={i.cost_per_unit_paise} />
                    </td>
                  )}
                  {seeValue && (
                    <td className={td + " text-right font-medium"}>
                      <Money paise={i.stock_value_paise} />
                    </td>
                  )}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td} colSpan={2}>
                  Total
                </td>
                <td className={td + " text-right"}>{formatQty(totalQty)}</td>
                {seeValue && <td className={td} />}
                {seeValue && (
                  <td className={td + " text-right"}>
                    <Money paise={totalValue} />
                  </td>
                )}
              </tr>
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
