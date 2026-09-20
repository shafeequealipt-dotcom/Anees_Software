import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { SearchBox, Tabs } from "@/components/simple-filters";
import { Badge, Empty, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { serialReport } from "@/server/profit-reports";

export const metadata = { title: "Serial numbers" };

export default async function SerialsPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  const user = await requireUser("reports.all");
  const sp = await searchParams;
  const show = sp.show ?? "all";
  let list = await serialReport(await getDb(), user.firmId, { q: sp.q });
  if (show === "in_stock" || show === "sold") list = list.filter((r) => r.status === show);
  return (
    <>
      <PageHeader title="Serial numbers" back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} subtitle="Every serial number entered on bills, and where it is now." />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Tabs param="show" current={show} options={[{ value: "all", label: "All" }, { value: "in_stock", label: "In stock" }, { value: "sold", label: "Sold" }]} />
        <SearchBox q={sp.q} placeholder="Serial number or item" />
      </div>
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="No serial numbers found">Enter serial numbers on the lines of purchase and sale bills for items with serial tracking.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Serial</th>
                <th className={th}>Status</th>
                <th className={th}>Last entry</th>
                <th className={th}>Party</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.item_id}-${r.serial}`} className="hover:bg-ground/60">
                  <td className={td}><Link href={`/items/${r.item_id}`} className="text-brand-600 hover:underline">{r.item_name}</Link></td>
                  <td className={td + " font-mono text-xs"}>{r.serial}</td>
                  <td className={td}><Badge tone={r.status === "in_stock" ? "good" : "neutral"}>{r.status === "in_stock" ? "In stock" : "Sold"}</Badge></td>
                  <td className={td}>{r.last_ref} · {formatDate(r.last_date)}</td>
                  <td className={td}>{r.party_name}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
