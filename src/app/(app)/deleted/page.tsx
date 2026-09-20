import Link from "next/link";
import { RestoreButton } from "@/components/restore-button";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { listDeletedVouchers } from "@/server/vouchers";

export const metadata = { title: "Deleted entries" };

export default async function DeletedPage() {
  const user = await requireUser("vouchers.restore");
  const list = await listDeletedVouchers(await getDb(), user.firmId);
  return (
    <>
      <PageHeader title="Deleted entries" subtitle="Deleted bills and entries are kept here. Restoring one puts it back exactly as it was, with the same number." />
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="Nothing has been deleted" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Entry</th>
                <th className={th}>Date</th>
                <th className={th}>Party</th>
                <th className={th + " text-right"}>Total</th>
                <th className={th}>Deleted</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td className={td}>
                    {VOUCHER_INFO[d.type].label} {d.prefix}
                    {d.number}
                  </td>
                  <td className={td}>{formatDate(d.date)}</td>
                  <td className={td}>{d.partyName}</td>
                  <td className={td + " text-right"}>
                    <Money paise={d.totalPaise} />
                  </td>
                  <td className={td + " text-muted"}>
                    {d.deletedAt ? formatDateTime(d.deletedAt) : ""}
                    {d.deletedBy ? ` · ${d.deletedBy}` : ""}
                  </td>
                  <td className={td + " text-right"}>
                    <RestoreButton id={d.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-muted">
        See <Link href="/settings/audit" className="text-brand-600 underline">the activity log</Link> for who deleted what.
      </p>
    </>
  );
}
