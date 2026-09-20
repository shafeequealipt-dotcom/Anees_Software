import Link from "next/link";
import { PrintButton } from "@/components/party-actions";
import { AsOfDate } from "@/components/simple-filters";
import { Empty, Money, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { trialBalance } from "@/server/gl";

export const metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const user = await requireUser("accounting.view");
  const asOf = (await searchParams).to ?? todayIST();
  const rows = await trialBalance(await getDb(), user.firmId, asOf);
  const dr = rows.reduce((s, r) => s + Math.max(0, r.net), 0);
  const cr = rows.reduce((s, r) => s + Math.max(0, -r.net), 0);
  return (
    <>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
        <AsOfDate value={asOf} />
        <PrintButton />
      </div>
      <Panel title={`Trial balance as of ${formatDate(asOf)}`} padded={false}>
        {rows.length === 0 ? (
          <Empty title="No entries yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Code</th>
                <th className={th}>Account</th>
                <th className={th}>Type</th>
                <th className={th + " text-right"}>Debit</th>
                <th className={th + " text-right"}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-ground/60">
                  <td className={td + " font-mono text-xs"}>{r.code}</td>
                  <td className={td}>
                    <Link href={`/accounting/accounts/${r.id}`} className="text-brand-600 hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className={td + " capitalize text-muted"}>{r.type}</td>
                  <td className={td + " text-right"}>{r.net > 0 ? <Money paise={r.net} /> : ""}</td>
                  <td className={td + " text-right"}>{r.net < 0 ? <Money paise={-r.net} /> : ""}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td} colSpan={3}>
                  Total {dr === cr ? "" : "(does not balance!)"}
                </td>
                <td className={td + " text-right"}><Money paise={dr} /></td>
                <td className={td + " text-right"}><Money paise={cr} /></td>
              </tr>
            </tbody>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-muted">Stock on hand is not in the trial balance. It is valued from your stock records and added on the balance sheet.</p>
    </>
  );
}
