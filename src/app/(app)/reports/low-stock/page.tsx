import Link from "next/link";
import { Badge, Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatQty } from "@/lib/money";
import { stockSummary } from "@/server/reports";

export const metadata = { title: "Low stock" };

export default async function LowStockPage() {
  const user = await requireUser("reports.all");
  const db = await getDb();
  const list = await stockSummary(db, user.firmId, { lowOnly: true });

  return (
    <>
      <PageHeader title="Low stock" subtitle="Items at or below their alert level." back={{ href: "/reports", label: "Reports" }} />
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="Nothing is low on stock right now" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th + " text-right"}>In stock</th>
                <th className={th + " text-right"}>Alert level</th>
                <th className={th + " text-right"}>Value</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className="hover:bg-ground/60">
                  <td className={td}>
                    <Link href={`/items/${i.id}`} className="font-medium text-brand-600 hover:underline">
                      {i.name}
                    </Link>
                    <div className="text-xs text-faint">{i.code}</div>
                  </td>
                  <td className={td + " text-right"}>
                    <span className="font-medium text-warn">
                      {formatQty(i.qty_milli)} {i.unit_code}
                    </span>
                  </td>
                  <td className={td + " text-right text-muted"}>
                    {formatQty(i.min_stock_milli)} {i.unit_code}
                  </td>
                  <td className={td + " text-right"}>
                    <Money paise={i.stock_value_paise} />
                  </td>
                  <td className={td}>
                    <Badge tone="warn">Low</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
