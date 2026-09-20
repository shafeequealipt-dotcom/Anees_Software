import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { DateRange, Tabs } from "@/components/simple-filters";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { billProfit, groupByParty } from "@/server/profit-reports";

export const metadata = { title: "Profit on bills and parties" };

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; view?: string }> }) {
  const user = await requireUser("see.profit");
  const sp = await searchParams;
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const view = sp.view === "party" ? "party" : "bill";
  const bills = await billProfit(await getDb(), user.firmId, { from, to });
  const parties = groupByParty(bills);
  const sum = (k: "revenue_paise" | "cost_paise" | "profit_paise") => bills.reduce((s, r) => s + r[k], 0);
  const margin = sum("revenue_paise") > 0 ? Math.round((sum("profit_paise") * 10000) / sum("revenue_paise")) : 0;

  return (
    <>
      <PageHeader title="Profit on bills and parties" back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} subtitle="Sale price before tax, minus what the goods cost. Sale returns count against profit. Services have no cost." />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Tabs param="view" current={view === "bill" ? "all" : "party"} options={[{ value: "all", label: "Bill-wise" }, { value: "party", label: "Party-wise" }]} />
        <DateRange from={from} to={to} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sales (before tax)", <Money key="a" paise={sum("revenue_paise")} />],
          ["Cost of goods", <Money key="b" paise={sum("cost_paise")} />],
          ["Profit", <Money key="c" paise={sum("profit_paise")} className={sum("profit_paise") < 0 ? "text-bad" : "text-good"} />],
          ["Margin", <span key="d" className="num">{formatPercent(margin)}</span>],
        ].map(([k, v], i) => (
          <div key={i} className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <Panel padded={false} title={`${formatDate(from)} – ${formatDate(to)}`}>
        {bills.length === 0 ? (
          <Empty title="No sales in this period" />
        ) : view === "bill" ? (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Bill</th>
                <th className={th}>Party</th>
                <th className={th + " text-right"}>Sale</th>
                <th className={th + " text-right"}>Cost</th>
                <th className={th + " text-right"}>Profit</th>
                <th className={th + " text-right"}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="hover:bg-ground/60">
                  <td className={td}>{formatDate(b.date)}</td>
                  <td className={td}>
                    <Link href={`${b.type === "credit_note" ? "/sale-returns" : "/sales"}/${b.id}`} className="text-brand-600 hover:underline">
                      {b.prefix}
                      {b.number}
                    </Link>
                  </td>
                  <td className={td}>{b.party_name}</td>
                  <td className={td + " text-right"}><Money paise={b.revenue_paise} /></td>
                  <td className={td + " text-right"}><Money paise={b.cost_paise} /></td>
                  <td className={td + " text-right font-medium"}><Money paise={b.profit_paise} className={b.profit_paise < 0 ? "text-bad" : ""} /></td>
                  <td className={td + " num text-right"}>{formatPercent(b.margin_bp)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Party</th>
                <th className={th + " text-right"}>Bills</th>
                <th className={th + " text-right"}>Sale</th>
                <th className={th + " text-right"}>Cost</th>
                <th className={th + " text-right"}>Profit</th>
                <th className={th + " text-right"}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.party_id ?? "walkin"} className="hover:bg-ground/60">
                  <td className={td}>{p.party_id ? <Link href={`/parties/${p.party_id}`} className="text-brand-600 hover:underline">{p.party_name}</Link> : p.party_name}</td>
                  <td className={td + " num text-right"}>{p.bills}</td>
                  <td className={td + " text-right"}><Money paise={p.revenue_paise} /></td>
                  <td className={td + " text-right"}><Money paise={p.cost_paise} /></td>
                  <td className={td + " text-right font-medium"}><Money paise={p.profit_paise} className={p.profit_paise < 0 ? "text-bad" : ""} /></td>
                  <td className={td + " num text-right"}>{formatPercent(p.margin_bp)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
