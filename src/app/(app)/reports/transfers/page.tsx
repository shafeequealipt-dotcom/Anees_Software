import { PrintButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { returnReasonLabel } from "@/lib/voucher-types";
import { transfersReport } from "@/server/reports";

export const metadata = { title: "Transfers & returns" };

export default async function TransfersReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser("reports.all");
  const sp = await searchParams;
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const db = await getDb();
  const report = await transfersReport(db, user.firmId, from, to);

  return (
    <>
      <PageHeader title="Transfers & returns" subtitle="In-transit stock, shortages and damage, supplier returns by reason." back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} />
      <div className="no-print mb-4">
        <DateRange from={from} to={to} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg border border-line bg-panel px-3 py-2">
          <div className="text-xs text-muted">Sitting in transit right now</div>
          <div className="num mt-0.5 font-semibold">{formatQty(report.inTransit.qty_milli)} units</div>
        </div>
        <div className="rounded-lg border border-line bg-panel px-3 py-2">
          <div className="text-xs text-muted">In-transit value (at cost)</div>
          <Money paise={report.inTransit.value_paise} className="mt-0.5 block font-semibold" />
        </div>
      </div>

      <Panel title={`Shortages & damage by shop · ${formatDate(from)} – ${formatDate(to)}`} padded={false} className="mb-4">
        {report.byShop.length === 0 ? (
          <Empty title="No shortages or damage received in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Shop</th>
                <th className={th + " text-right"}>Transfers received</th>
                <th className={th + " text-right"}>Damaged (value)</th>
                <th className={th + " text-right"}>Short (value)</th>
              </tr>
            </thead>
            <tbody>
              {report.byShop.map((r) => (
                <tr key={r.location_id} className="hover:bg-ground/60">
                  <td className={td}>{r.location_name}</td>
                  <td className={td + " text-right"}>{r.transfers}</td>
                  <td className={td + " text-right"}>
                    <Money paise={r.damaged_value_paise} blankZero />
                  </td>
                  <td className={td + " text-right" + (r.short_value_paise > 0 ? " text-bad" : "")}>
                    <Money paise={r.short_value_paise} blankZero />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel title={`Supplier returns by reason · ${formatDate(from)} – ${formatDate(to)}`} padded={false}>
        {report.byReason.length === 0 ? (
          <Empty title="No purchase returns in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Reason</th>
                <th className={th + " text-right"}>Returns</th>
                <th className={th + " text-right"}>Value</th>
              </tr>
            </thead>
            <tbody>
              {report.byReason.map((r) => (
                <tr key={r.reason} className="hover:bg-ground/60">
                  <td className={td}>{r.reason === "not_specified" ? "Not specified" : returnReasonLabel(r.reason)}</td>
                  <td className={td + " text-right"}>{r.count}</td>
                  <td className={td + " text-right"}>
                    <Money paise={r.value_paise} />
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
