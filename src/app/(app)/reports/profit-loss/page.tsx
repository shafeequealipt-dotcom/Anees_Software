import { PrintButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Money, PageHeader, Panel } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { profitAndLoss } from "@/server/reports";

export const metadata = { title: "Profit & loss" };

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser("reports.all");
  const sp = await searchParams;
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const db = await getDb();
  const p = await profitAndLoss(db, from, to);

  return (
    <>
      <PageHeader title="Profit & loss" back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} />
      <div className="no-print mb-4">
        <DateRange from={from} to={to} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Trading account · ${formatDate(from)} – ${formatDate(to)}`}>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Sales" v={p.sales} />
            {p.saleReturns > 0 && <Row k="Less: sale returns" v={-p.saleReturns} />}
            <Row k="Net sales" v={p.netSales} bold />
            <div className="my-1 border-t border-line" />
            <Row k="Opening stock" v={p.openingStock} />
            <Row k="Purchases" v={p.purchases} />
            {p.purchaseReturns > 0 && <Row k="Less: purchase returns" v={-p.purchaseReturns} />}
            <Row k="Less: closing stock" v={-p.closingStock} />
            <Row k="Cost of goods sold" v={p.costOfGoodsSold} bold />
            <div className="my-1 border-t border-line pt-1" />
            <Row k="Gross profit" v={p.grossProfit} bold tone={p.grossProfit >= 0 ? "good" : "bad"} />
          </dl>
        </Panel>
        <Panel title="Profit & loss account">
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Gross profit" v={p.grossProfit} />
            <Row k="Other income" v={p.otherIncome} />
            <Row k="Less: expenses" v={-p.expenses} />
            <div className="my-1 border-t border-line pt-1" />
            <Row k="Net profit" v={p.netProfit} bold tone={p.netProfit >= 0 ? "good" : "bad"} />
          </dl>
          {p.expenseByCategory.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-1.5 text-xs font-medium uppercase text-muted">Expenses by category</div>
              <dl className="flex flex-col gap-1 text-sm">
                {p.expenseByCategory.map((c) => (
                  <Row key={c.name} k={c.name} v={c.amount} />
                ))}
              </dl>
            </div>
          )}
          {p.incomeByCategory.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-1.5 text-xs font-medium uppercase text-muted">Other income by category</div>
              <dl className="flex flex-col gap-1 text-sm">
                {p.incomeByCategory.map((c) => (
                  <Row key={c.name} k={c.name} v={c.amount} />
                ))}
              </dl>
            </div>
          )}
        </Panel>
      </div>
      <p className="mt-3 text-xs text-faint">
        Cost of goods sold values stock at purchase cost (excluding tax). This is an accounting estimate for the period, not a formal
        audited statement.
      </p>
    </>
  );
}

function Row({ k, v, bold, tone }: { k: string; v: number; bold?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className={`flex items-baseline justify-between ${bold ? "font-semibold" : ""}`}>
      <span className={bold ? "" : "text-muted"}>{k}</span>
      <Money paise={v} className={tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""} />
    </div>
  );
}
