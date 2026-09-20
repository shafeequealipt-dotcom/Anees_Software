import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { accountLedger } from "@/server/gl";

export const metadata = { title: "Account ledger" };

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser("accounting.view");
  const sp = await searchParams;
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const led = await accountLedger(await getDb(), user.firmId, Number((await params).id) || 0, from, to);
  if (!led) notFound();
  const side = (n: number) => (n === 0 ? "" : n > 0 ? "Dr" : "Cr");
  return (
    <>
      <PageHeader title={`${led.account.code} · ${led.account.name}`} back={{ href: "/accounting/accounts", label: "Chart of accounts" }} actions={<PrintButton />} />
      <div className="no-print mb-3">
        <DateRange from={from} to={to} />
      </div>
      <Panel title={`${formatDate(from)} – ${formatDate(to)}`} padded={false}>
        {led.entries.length === 0 && led.openingNet === 0 ? (
          <Empty title="No entries in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Entry</th>
                <th className={th + " text-right"}>Debit</th>
                <th className={th + " text-right"}>Credit</th>
                <th className={th + " text-right"}>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-ground/40">
                <td className={td}>{formatDate(from)}</td>
                <td className={td + " font-medium"}>Opening balance</td>
                <td className={td} />
                <td className={td} />
                <td className={td + " text-right"}><Money paise={Math.abs(led.openingNet)} /> {side(led.openingNet)}</td>
              </tr>
              {led.entries.map((e) => (
                <tr key={e.id} className="hover:bg-ground/60">
                  <td className={td}>{formatDate(e.date)}</td>
                  <td className={td}>
                    {e.voucherId && e.vType ? (
                      <Link href={`${VOUCHER_INFO[e.vType].path}/${e.voucherId}`} className="text-brand-600 hover:underline">
                        {VOUCHER_INFO[e.vType].label} {e.vPrefix}
                        {e.vNumber}
                      </Link>
                    ) : e.source === "journal" ? (
                      <Link href="/accounting/journal" className="text-brand-600 hover:underline">Journal entry</Link>
                    ) : e.source === "opening" ? (
                      "Opening balance"
                    ) : (
                      "Fixed asset"
                    )}
                    {e.partyName ? ` · ${e.partyName}` : ""}
                    {e.memo ? <span className="text-xs text-muted"> — {e.memo}</span> : null}
                  </td>
                  <td className={td + " text-right"}>{e.debit ? <Money paise={e.debit} /> : ""}</td>
                  <td className={td + " text-right"}>{e.credit ? <Money paise={e.credit} /> : ""}</td>
                  <td className={td + " text-right"}><Money paise={Math.abs(e.balance)} /> <span className="text-xs text-faint">{side(e.balance)}</span></td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td} colSpan={4}>Closing balance</td>
                <td className={td + " text-right"}><Money paise={Math.abs(led.closingNet)} /> {side(led.closingNet)}</td>
              </tr>
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
