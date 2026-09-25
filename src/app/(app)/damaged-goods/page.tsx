import Link from "next/link";
import { Empty, LinkButton, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { locations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatQty } from "@/lib/money";
import { can } from "@/lib/permissions";
import { stockSummary } from "@/server/reports";
import { and, eq } from "drizzle-orm";

export const metadata = { title: "Damaged goods" };

export default async function DamagedGoodsPage() {
  const user = await requireUser("vouchers.create");
  const db = await getDb();
  const [damaged] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.firmId, user.firmId), eq(locations.kind, "damaged")));
  const seeValue = can(user, "see.stockValue");
  const list = damaged ? (await stockSummary(db, user.firmId, { locationId: damaged.id, includeInactive: true })).filter((i) => i.qty_milli > 0) : [];
  const totalValue = list.reduce((s, i) => s + i.stock_value_paise, 0);
  const totalQty = list.reduce((s, i) => s + i.qty_milli, 0);
  const returnHref = damaged ? `/purchase-returns/new?location=${damaged.id}` : "";
  const writeOffHref = damaged ? `/stock-adjustments/new?location=${damaged.id}` : "";

  return (
    <>
      <PageHeader
        title="Damaged goods"
        actions={
          damaged && list.length > 0 ? (
            <>
              <LinkButton href={writeOffHref} variant="secondary">Write off</LinkButton>
              <LinkButton href={returnHref} variant="primary">Return to supplier</LinkButton>
            </>
          ) : undefined
        }
      />
      <p className="mb-4 text-sm text-muted">
        Stock marked damaged when receiving a shop-to-shop transfer, waiting here to be returned to the supplier or written off.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg border border-line bg-panel px-3 py-2">
          <div className="text-xs text-muted">Items</div>
          <div className="font-semibold">{list.length}</div>
        </div>
        {seeValue && (
          <div className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-xs text-muted">Value (at cost)</div>
            <Money paise={totalValue} className="font-semibold" />
          </div>
        )}
      </div>
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="Nothing marked damaged right now">Damage recorded when receiving a stock transfer lands here.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th + " text-right"}>Quantity</th>
                {seeValue && <th className={th + " text-right"}>Cost / unit</th>}
                {seeValue && <th className={th + " text-right"}>Value</th>}
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
                <td className={td}>Total</td>
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
