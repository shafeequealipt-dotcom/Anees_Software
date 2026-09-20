import Link from "next/link";
import { ServiceDoneButton } from "@/components/service-done-button";
import { Badge, Empty, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { listServiceReminders } from "@/server/notify/service";

export const metadata = { title: "Service reminders" };

export default async function ServicesPage() {
  const user = await requireUser();
  const today = todayIST();
  const list = await listServiceReminders(await getDb(), user.firmId, { status: "pending" });
  return (
    <>
      <PageHeader title="Service reminders" subtitle="Items that need a service visit. Set the interval on each item; a reminder is created every time it is sold on an invoice." />
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="No services coming up">Give an item a &ldquo;service reminder&rdquo; interval (on the item&apos;s edit page), then sell it on an invoice.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Due</th>
                <th className={th}>Customer</th>
                <th className={th}>Item</th>
                <th className={th}>Sold on</th>
                <th className={th}>Reminder</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className={td + " whitespace-nowrap"}>
                    {formatDate(r.dueDate)} {r.dueDate < today && <Badge tone="bad">Overdue</Badge>}
                  </td>
                  <td className={td}>{r.partyId ? <Link href={`/parties/${r.partyId}`} className="text-brand-600 hover:underline">{r.partyName}</Link> : r.partyName}</td>
                  <td className={td}>{r.itemName}</td>
                  <td className={td}>
                    <Link href={`/sales/${r.voucherId}`} className="text-brand-600 hover:underline">
                      {r.vPrefix}
                      {r.vNumber}
                    </Link>
                  </td>
                  <td className={td + " text-muted"}>{r.notifiedAt ? "Sent" : "Not yet"}</td>
                  <td className={td + " text-right"}>{can(user, "masters.edit") && <ServiceDoneButton id={r.id} />}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
