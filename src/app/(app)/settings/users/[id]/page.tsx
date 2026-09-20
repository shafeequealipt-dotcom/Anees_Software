import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { ResetPasswordPanel, UserForm } from "@/components/user-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listRoles, listUsers } from "@/server/admin";

export const metadata = { title: "Edit user" };

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser("users.manage");
  const id = Number((await params).id);
  const db = await getDb();
  const [u] = (await listUsers(db)).filter((x) => x.id === id);
  if (!u) notFound();
  const roles = await listRoles(db);
  return (
    <>
      <PageHeader title={u.name} subtitle={u.email} back={{ href: "/settings/users", label: "Users" }} />
      <div className="flex flex-col gap-6">
        <UserForm
          roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description }))}
          isSelf={u.id === me.id}
          initial={{ id: u.id, name: u.name, email: u.email, phone: u.phone ?? "", roleId: u.roleId, active: u.active }}
        />
        {u.id !== me.id && <ResetPasswordPanel userId={u.id} name={u.name} />}
      </div>
    </>
  );
}
