import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { Tabs } from "@/components/simple-filters";
import { Badge, Empty, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { batchStock } from "@/server/profit-reports";

export const metadata = { title: "Batches and expiry" };

export default async function BatchesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser("reports.all");
  const sp = await searchParams;
  const show = sp.show ?? "all";
  let list = await batchStock(await getDb(), user.firmId, { today: todayIST(), includeEmpty: show === "empty" });
  if (show === "soon") list = list.filter((r) => r.days_to_expiry !== null && r.days_to_expiry <= 60);
  return (
    <>
      <PageHeader title="Batches and expiry" back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} subtitle="Items with batch tracking switched on, or stock that carries a batch number." />
      <div className="no-print mb-4">
        <Tabs param="show" current={show} options={[{ value: "all", label: "In stock" }, { value: "soon", label: "Expires within 60 days" }, { value: "empty", label: "Including used-up batches" }]} />
      </div>
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="No batches to show">Switch on &ldquo;Track batches&rdquo; for an item, then enter batch numbers and expiry dates on its purchase bills.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Batch</th>
                <th className={th}>Expiry</th>
                <th className={th + " text-right"}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.item_id}-${r.batch_no}`} className="hover:bg-ground/60">
                  <td className={td}><Link href={`/items/${r.item_id}`} className="text-brand-600 hover:underline">{r.item_name}</Link></td>
                  <td className={td + " font-mono text-xs"}>{r.batch_no}</td>
                  <td className={td}>
                    {r.expiry_date ? formatDate(r.expiry_date) : "—"}{" "}
                    {r.days_to_expiry !== null && r.days_to_expiry < 0 && <Badge tone="bad">Expired</Badge>}
                    {r.days_to_expiry !== null && r.days_to_expiry >= 0 && r.days_to_expiry <= 60 && <Badge tone="warn">{r.days_to_expiry} days</Badge>}
                  </td>
                  <td className={td + " num text-right"}>{formatQty(r.qty_milli)} {r.unit_code}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
