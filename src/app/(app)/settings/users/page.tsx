import { getDb } from "@/db";
import { Badge, Empty, LinkButton, Panel, Table, td, th } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { listUsers } from "@/server/admin";
import Link from "next/link";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireUser("users.manage");
  const list = await listUsers(await getDb());
  return (
    <Panel
      title={`Users (${list.length})`}
      padded={false}
      actions={
        <LinkButton size="sm" variant="primary" href="/settings/users/new">
          + Add user
        </LinkButton>
      }
    >
      {list.length === 0 ? (
        <Empty title="No users yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Email</th>
              <th className={th}>Role</th>
              <th className={th}>Last sign-in</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                <td className={td}>
                  <Link href={`/settings/users/${u.id}`} className="font-medium text-brand-600 hover:underline">
                    {u.name}
                  </Link>
                  {u.id === me.id && <span className="ml-1.5 text-xs text-faint">(you)</span>}
                </td>
                <td className={td}>{u.email}</td>
                <td className={td}>
                  <Badge tone={u.isOwner ? "brand" : "neutral"}>{u.roleName}</Badge>
                </td>
                <td className={td + " text-muted"}>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                <td className={td}>
                  {!u.active ? <Badge tone="bad">Deactivated</Badge> : u.mustChangePassword ? <Badge tone="warn">Temporary password</Badge> : <Badge tone="good">Active</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
