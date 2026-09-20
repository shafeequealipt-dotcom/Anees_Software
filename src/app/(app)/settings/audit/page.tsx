import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, users } from "@/db/schema";
import { Empty, Panel, Table, td, th } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Activity log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; id?: string }> }) {
  await requireUser("audit.view");
  const sp = await searchParams;
  const db = await getDb();
  const list = await db
    .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, entity: auditLog.entity, summary: auditLog.summary, ip: auditLog.ip, user: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(sp.entity ? eq(auditLog.entity, sp.entity) : sql`true`, sp.id ? eq(auditLog.entityId, Number(sp.id) || 0) : sql`true`))
    .orderBy(desc(auditLog.id))
    .limit(300);
  return (
    <Panel title={sp.entity ? `Activity: ${sp.entity}` : "Activity log"} padded={false}>
      {list.length === 0 ? (
        <Empty title="Nothing recorded yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Who</th>
              <th className={th}>What happened</th>
              <th className={th}>From</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td className={td + " whitespace-nowrap text-muted"}>{formatDateTime(a.at)}</td>
                <td className={td + " whitespace-nowrap"}>{a.user ?? "—"}</td>
                <td className={td}>{a.summary}</td>
                <td className={td + " font-mono text-xs text-faint"}>{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">Showing the latest 300 entries.</p>
    </Panel>
  );
}
