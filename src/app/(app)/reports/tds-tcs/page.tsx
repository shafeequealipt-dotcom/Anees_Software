import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import type { VoucherType } from "@/db/schema";
import { type TdsTcsRow, tdsTcsReport } from "@/server/profit-reports";

export const metadata = { title: "TCS and TDS" };

function Section({ title, rows, total, col }: { title: string; rows: TdsTcsRow[]; total: number; col: "tcs" | "tds" }) {
  return (
    <Panel title={title} padded={false} actions={<span className="text-sm font-semibold"><Money paise={total} /></span>}>
      {rows.length === 0 ? (
        <Empty title="Nothing in this period" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Bill</th>
              <th className={th}>Party</th>
              <th className={th}>GSTIN</th>
              <th className={th + " text-right"}>Taxable value</th>
              <th className={th + " text-right"}>Rate</th>
              <th className={th + " text-right"}>{col === "tcs" ? "TCS" : "TDS"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>{formatDate(r.date)}</td>
                <td className={td}>
                  <Link href={`${VOUCHER_INFO[r.type as VoucherType].path}/${r.id}`} className="text-brand-600 hover:underline">
                    {r.prefix}
                    {r.number}
                  </Link>
                </td>
                <td className={td}>{r.party_name}</td>
                <td className={td + " font-mono text-xs"}>{r.party_gstin}</td>
                <td className={td + " text-right"}><Money paise={r.taxable_paise} /></td>
                <td className={td + " num text-right"}>{formatPercent(col === "tcs" ? r.tcs_bp : r.tds_bp)}</td>
                <td className={td + " text-right font-medium"}><Money paise={col === "tcs" ? r.tcs_paise : r.tds_paise} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

export default async function TdsTcsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser("reports.all");
  const sp = await searchParams;
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const r = await tdsTcsReport(await getDb(), user.firmId, from, to);
  return (
    <>
      <PageHeader title="TCS and TDS" back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} subtitle={`${formatDate(from)} – ${formatDate(to)}`} />
      <div className="no-print mb-4">
        <DateRange from={from} to={to} />
      </div>
      <div className="flex flex-col gap-4">
        <Section title="TCS collected on your sales (pay to the government)" rows={r.tcs} total={r.tcsTotal} col="tcs" />
        <Section title="TDS deducted by your customers (claim as credit)" rows={r.tdsReceivable} total={r.tdsReceivableTotal} col="tds" />
        <Section title="TDS you deducted from suppliers (pay to the government)" rows={r.tdsPayable} total={r.tdsPayableTotal} col="tds" />
      </div>
    </>
  );
}
