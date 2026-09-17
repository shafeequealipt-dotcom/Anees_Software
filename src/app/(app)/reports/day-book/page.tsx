import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Badge, Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { dayBook } from "@/server/reports";

export const metadata = { title: "Day book" };

export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser("reports.all");
  const sp = await searchParams;
  const today = todayIST();
  const from = sp.from ?? today;
  const to = sp.to ?? today;
  const db = await getDb();
  const list = await dayBook(db, from, to);
  const seeMoney = can(user.role, "money.view");

  const moneyIn = list.reduce((s, r) => s + r.money_in, 0);
  const moneyOut = list.reduce((s, r) => s + r.money_out, 0);

  return (
    <>
      <PageHeader
        title="Day book"
        subtitle="Every entry created, in order — the full record of what happened."
        back={{ href: "/reports", label: "Reports" }}
        actions={<PrintButton />}
      />
      <div className="no-print mb-4">
        <DateRange from={from} to={to} />
      </div>
      {seeMoney && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-xs text-muted">Money in</div>
            <Money paise={moneyIn} className="font-semibold text-good" />
          </div>
          <div className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-xs text-muted">Money out</div>
            <Money paise={moneyOut} className="font-semibold text-bad" />
          </div>
        </div>
      )}
      <Panel padded={false} title={`${formatDate(from)} – ${formatDate(to)}`}>
        {list.length === 0 ? (
          <Empty title="Nothing entered in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Entry</th>
                <th className={th}>Party</th>
                {seeMoney && <th className={th + " text-right"}>Money in</th>}
                {seeMoney && <th className={th + " text-right"}>Money out</th>}
                <th className={th + " text-right"}>Total</th>
                <th className={th}>By</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className={"hover:bg-ground/60 " + (r.status === "cancelled" ? "text-faint line-through" : "")}>
                  <td className={td}>{formatDate(r.date)}</td>
                  <td className={td}>
                    <Link href={`${VOUCHER_INFO[r.type].path}/${r.id}`} className="text-brand-600 hover:underline">
                      {VOUCHER_INFO[r.type].label} {r.prefix}
                      {r.number}
                    </Link>
                    {r.status === "cancelled" && (
                      <>
                        {" "}
                        <Badge>Cancelled</Badge>
                      </>
                    )}
                  </td>
                  <td className={td}>{r.party_name}</td>
                  {seeMoney && (
                    <td className={td + " text-right"}>
                      <Money paise={r.money_in} blankZero />
                    </td>
                  )}
                  {seeMoney && (
                    <td className={td + " text-right"}>
                      <Money paise={r.money_out} blankZero />
                    </td>
                  )}
                  <td className={td + " text-right"}>
                    <Money paise={r.total_paise} />
                  </td>
                  <td className={td + " text-muted"}>{r.created_by}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
