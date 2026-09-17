import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { DateRange, Tabs } from "@/components/simple-filters";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { itemSales } from "@/server/reports";

export const metadata = { title: "Item-wise sales" };

export default async function ItemSalesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; side?: string }> }) {
  await requireUser("reports.all");
  const sp = await searchParams;
  const side = sp.side === "purchase" ? "purchase" : "sale";
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const db = await getDb();
  const list = await itemSales(db, from, to, side);
  const totalQty = list.reduce((s, r) => s + r.qty_milli, 0);
  const totalTaxable = list.reduce((s, r) => s + r.taxable_paise, 0);
  const totalAmount = list.reduce((s, r) => s + r.total_paise, 0);

  return (
    <>
      <PageHeader title={side === "sale" ? "Item-wise sales" : "Item-wise purchases"} back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Tabs param="side" current={side === "sale" ? "all" : "purchase"} options={[{ value: "all", label: "Sales" }, { value: "purchase", label: "Purchases" }]} />
        <DateRange from={from} to={to} />
      </div>
      <Panel padded={false} title={`${formatDate(from)} – ${formatDate(to)}`}>
        {list.length === 0 ? (
          <Empty title="Nothing sold in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th + " text-right"}>Quantity</th>
                <th className={th + " text-right"}>Taxable value</th>
                <th className={th + " text-right"}>Total</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.item_id ?? r.name} className="hover:bg-ground/60">
                  <td className={td}>{r.item_id ? <Link href={`/items/${r.item_id}`} className="text-brand-600 hover:underline">{r.name}</Link> : r.name}</td>
                  <td className={td + " text-right"}>
                    {formatQty(r.qty_milli)} {r.unit_code}
                  </td>
                  <td className={td + " text-right"}>
                    <Money paise={r.taxable_paise} />
                  </td>
                  <td className={td + " text-right font-medium"}>
                    <Money paise={r.total_paise} />
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total</td>
                <td className={td + " text-right"}>{formatQty(totalQty)}</td>
                <td className={td + " text-right"}>
                  <Money paise={totalTaxable} />
                </td>
                <td className={td + " text-right"}>
                  <Money paise={totalAmount} />
                </td>
              </tr>
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
