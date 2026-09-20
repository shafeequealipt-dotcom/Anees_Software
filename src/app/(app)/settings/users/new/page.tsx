import { getDb } from "@/db";
import { UserForm } from "@/components/user-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listRoles } from "@/server/admin";

export const metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requireUser("users.manage");
  const roles = await listRoles(await getDb());
  return (
    <>
      <PageHeader title="Add user" back={{ href: "/settings/users", label: "Users" }} />
      <UserForm roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description }))} />
    </>
  );
}
