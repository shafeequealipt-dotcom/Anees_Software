import { PrintButton } from "@/components/party-actions";
import { DateRange, Tabs } from "@/components/simple-filters";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { region, taxColumnLabels } from "@/lib/region";
import { taxReport } from "@/server/reports";

export const metadata = { title: "Tax report" };

export default async function TaxReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; side?: string }> }) {
  await requireUser("reports.all");
  const sp = await searchParams;
  const side = sp.side === "inward" ? "inward" : "outward";
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const db = await getDb();
  const list = await taxReport(db, from, to, side);
  const sum = (f: (r: (typeof list)[number]) => number) => list.reduce((s, r) => s + f(r), 0);

  return (
    <>
      <PageHeader title="Tax report" subtitle={`${region().taxName} by rate, from your sales and purchases.`} back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Tabs param="side" current={side === "outward" ? "all" : "inward"} options={[{ value: "all", label: "Output (sales)" }, { value: "inward", label: "Input (purchases)" }]} />
        <DateRange from={from} to={to} />
      </div>
      <Panel padded={false} title={`${formatDate(from)} – ${formatDate(to)}`}>
        {list.length === 0 ? (
          <Empty title="No taxable entries in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Rate</th>
                <th className={th + " text-right"}>Taxable value</th>
                {region().usesStates && <th className={th + " text-right"}>CGST</th>}
                {region().usesStates && <th className={th + " text-right"}>SGST</th>}
                <th className={th + " text-right"}>{taxColumnLabels().igst}</th>
                <th className={th + " text-right"}>Cess</th>
                <th className={th + " text-right"}>Total tax</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.gst_bp}-${r.cess_bp}`} className="hover:bg-ground/60">
                  <td className={td}>
                    {formatPercent(r.gst_bp)}
                    {r.cess_bp > 0 && <span className="text-xs text-faint"> + cess {formatPercent(r.cess_bp)}</span>}
                  </td>
                  <td className={td + " text-right"}>
                    <Money paise={r.taxable_paise} />
                  </td>
                  {region().usesStates && (
                    <td className={td + " text-right"}>
                      <Money paise={r.cgst_paise} blankZero />
                    </td>
                  )}
                  {region().usesStates && (
                    <td className={td + " text-right"}>
                      <Money paise={r.sgst_paise} blankZero />
                    </td>
                  )}
                  <td className={td + " text-right"}>
                    <Money paise={r.igst_paise} blankZero />
                  </td>
                  <td className={td + " text-right"}>
                    <Money paise={r.cess_paise} blankZero />
                  </td>
                  <td className={td + " text-right font-medium"}>
                    <Money paise={r.cgst_paise + r.sgst_paise + r.igst_paise + r.cess_paise} />
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total</td>
                <td className={td + " text-right"}>
                  <Money paise={sum((r) => r.taxable_paise)} />
                </td>
                {region().usesStates && (
                  <td className={td + " text-right"}>
                    <Money paise={sum((r) => r.cgst_paise)} />
                  </td>
                )}
                {region().usesStates && (
                  <td className={td + " text-right"}>
                    <Money paise={sum((r) => r.sgst_paise)} />
                  </td>
                )}
                <td className={td + " text-right"}>
                  <Money paise={sum((r) => r.igst_paise)} />
                </td>
                <td className={td + " text-right"}>
                  <Money paise={sum((r) => r.cess_paise)} />
                </td>
                <td className={td + " text-right"}>
                  <Money paise={sum((r) => r.cgst_paise + r.sgst_paise + r.igst_paise + r.cess_paise)} />
                </td>
              </tr>
            </tbody>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-faint">
        {region().country === "SA" ? "This is a working summary to help prepare your VAT return, not a ZATCA filing." : "This is a working summary for filing, not a GSTR-1 or GSTR-3B form. Those come in a later phase — see the plan document."}
      </p>
    </>
  );
}
