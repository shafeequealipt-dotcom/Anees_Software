import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { RoleForm } from "@/components/role-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listRoles } from "@/server/admin";

export const metadata = { title: "Edit role" };

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("users.manage");
  const id = Number((await params).id);
  const role = (await listRoles(await getDb())).find((r) => r.id === id);
  if (!role) notFound();
  return (
    <>
      <PageHeader title={role.name} back={{ href: "/settings/roles", label: "Roles & access" }} />
      <RoleForm
        initial={{ id: role.id, name: role.name, description: role.description ?? "", permissions: role.permissions }}
        isOwner={role.isOwner}
        isSystem={role.isSystem}
        userCount={role.userCount}
      />
    </>
  );
}
