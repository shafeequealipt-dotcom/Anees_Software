import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { RoleForm } from "@/components/role-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { listCompanies, listRoles } from "@/server/admin";

export const metadata = { title: "Edit role" };

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser("roles.manage");
  const id = Number((await params).id);
  const db = await getDb();
  // Only roles this person can see at all: another company's role answers "not found".
  const role = (await listRoles(db, me)).find((r) => r.id === id);
  if (!role) notFound();
  const companies = (await listCompanies(db, me)).filter((c) => c.active || c.id === role.firmId).map((c) => ({ id: c.id, name: c.name }));
  // Owners change any role but Owner; a company owner only their own companies' roles.
  const editable = !role.isOwner && (me.isOwner || (!role.isSystem && role.firmId !== null));
  return (
    <>
      <PageHeader title={role.name} back={{ href: "/settings/roles", label: "Roles & access" }} />
      <RoleForm
        initial={{ id: role.id, name: role.name, description: role.description ?? "", permissions: role.permissions, firmId: role.firmId }}
        isOwner={role.isOwner}
        isSystem={role.isSystem}
        userCount={role.userCount}
        companies={companies}
        allowShared={me.isOwner}
        allowed={me.isOwner ? ALL_PERMISSIONS : me.permissions}
        readOnly={!editable}
      />
    </>
  );
}
