import { DeleteJournalButton } from "@/components/accounting-forms";
import { Empty, LinkButton, Money, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { listJournals } from "@/server/gl";

export const metadata = { title: "Journal entries" };

export default async function JournalPage() {
  const user = await requireUser("accounting.view");
  const list = await listJournals(await getDb(), user.firmId);
  return (
    <Panel
      title="Manual journal entries"
      padded={false}
      actions={can(user, "accounting.edit") ? <LinkButton size="sm" variant="primary" href="/accounting/journal/new">+ New entry</LinkButton> : undefined}
    >
      <p className="border-b border-line px-4 py-3 text-sm text-muted">Bills post to the accounts by themselves. Use a journal entry for everything else: a loan, money you put into the business, a correction. Each entry must balance.</p>
      {list.length === 0 ? (
        <Empty title="No journal entries yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>No.</th>
              <th className={th}>Date</th>
              <th className={th}>Entry</th>
              <th className={th + " text-right"}>Amount</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((j) => (
              <tr key={j.id}>
                <td className={td + " num"}>{j.number}</td>
                <td className={td}>{formatDate(j.date)}</td>
                <td className={td}>
                  <div className="font-medium">{j.narration}</div>
                  <div className="text-xs text-muted">
                    {j.lines.map((l, i) => (
                      <span key={i} className="mr-3">
                        {l.debit ? "Dr" : "Cr"} {l.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className={td + " text-right"}><Money paise={j.totalPaise} /></td>
                <td className={td + " text-right"}>{can(user, "accounting.edit") && <DeleteJournalButton id={j.id} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
