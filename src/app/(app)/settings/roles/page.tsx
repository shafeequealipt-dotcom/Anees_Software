import Link from "next/link";
import { getDb } from "@/db";
import { Badge, LinkButton, Panel, Table, td, th } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { listRoles } from "@/server/admin";

export const metadata = { title: "Roles & access" };

/** Owners see every role; a company owner sees the built-in and shared roles plus their own companies' roles. */
export default async function RolesPage() {
  const me = await requireUser("roles.manage");
  const list = await listRoles(await getDb(), me);
  return (
    <Panel
      title="Roles & access"
      padded={false}
      actions={
        <LinkButton size="sm" variant="primary" href="/settings/roles/new">
          + New role
        </LinkButton>
      }
    >
      <p className="border-b border-line px-4 py-3 text-sm text-muted">
        A role decides what a person can do and which fields they can see. Give each user one role on the Users tab. Changes apply the next time the person opens a page.
        {me.isOwner ? " Built-in and shared roles are used by every company; a company's own role is only for its people and is seen only by its owners." : " Built-in and shared roles are set by the owner; you can add and change roles for your own company."}
      </p>
      <Table>
        <thead>
          <tr>
            <th className={th}>Role</th>
            <th className={th}>Company</th>
            <th className={th}>Access</th>
            <th className={th + " text-right"}>Users</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td className={td}>
                <Link href={`/settings/roles/${r.id}`} className="font-medium text-brand-600 hover:underline">
                  {r.name}
                </Link>
                {r.isSystem && <Badge tone="neutral"> built-in</Badge>}
                {r.description && <div className="text-xs text-muted">{r.description}</div>}
              </td>
              <td className={td + " text-muted"}>{r.firmName ?? "All companies"}</td>
              <td className={td + " text-muted"}>{r.isOwner ? "Everything" : `${r.permissions.length} of ${ALL_PERMISSIONS.length} permissions`}</td>
              <td className={td + " num text-right"}>{r.userCount}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
