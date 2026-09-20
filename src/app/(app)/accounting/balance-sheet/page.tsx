import { PrintButton } from "@/components/party-actions";
import { AsOfDate } from "@/components/simple-filters";
import { Alert, Money, Panel } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { balanceSheet } from "@/server/gl";
import { stockValueAt } from "@/server/reports";

export const metadata = { title: "Balance sheet" };

function Section({ title, groups, total }: { title: string; groups: { grp: string; rows: { name: string; amount: number }[]; total: number }[]; total: number }) {
  return (
    <Panel title={title} padded={false}>
      <div className="divide-y divide-line">
        {groups.map((g) => (
          <div key={g.grp} className="px-4 py-2">
            <div className="text-xs font-semibold uppercase text-muted">{g.grp}</div>
            {g.rows.map((r) => (
              <div key={r.name} className="flex justify-between py-0.5 text-sm">
                <span>{r.name}</span>
                <Money paise={r.amount} />
              </div>
            ))}
          </div>
        ))}
        <div className="flex justify-between px-4 py-2 font-semibold">
          <span>Total {title.toLowerCase()}</span>
          <Money paise={total} />
        </div>
      </div>
    </Panel>
  );
}

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const user = await requireUser("accounting.view");
  const asOf = (await searchParams).to ?? todayIST();
  const db = await getDb();
  const bs = await balanceSheet(db, user.firmId, asOf, await stockValueAt(db, user.firmId, asOf));
  const balanced = bs.totalAssets === bs.totalLiabilitiesAndEquity;
  return (
    <>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
        <AsOfDate value={asOf} />
        <PrintButton />
      </div>
      {!balanced && <div className="mb-3"><Alert tone="bad">The balance sheet is out by <Money paise={Math.abs(bs.totalAssets - bs.totalLiabilitiesAndEquity)} />. Open Chart of accounts and use &ldquo;Rebuild books&rdquo;, or tell your support person.</Alert></div>}
      <p className="mb-3 text-sm text-muted">As of {formatDate(asOf)}. Stock is valued at cost from your stock records.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Assets" groups={bs.assets} total={bs.totalAssets} />
        <div className="flex flex-col gap-4">
          <Section title="Liabilities" groups={bs.liabilities} total={bs.liabilities.reduce((s, g) => s + g.total, 0)} />
          <Panel title="Equity" padded={false}>
            <div className="divide-y divide-line">
              <div className="px-4 py-2">
                {bs.equity.map((r) => (
                  <div key={r.name} className="flex justify-between py-0.5 text-sm">
                    <span>{r.name}</span>
                    <Money paise={r.amount} className={r.amount < 0 ? "text-bad" : ""} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between px-4 py-2 font-semibold">
                <span>Total liabilities and equity</span>
                <Money paise={bs.totalLiabilitiesAndEquity} />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
