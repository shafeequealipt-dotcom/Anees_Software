import { RoleForm } from "@/components/role-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { listCompanies } from "@/server/admin";

export const metadata = { title: "New role" };

export default async function NewRolePage() {
  const me = await requireUser("roles.manage");
  const companies = (await listCompanies(await getDb(), me)).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <PageHeader title="New role" back={{ href: "/settings/roles", label: "Roles & access" }} />
      <RoleForm
        initial={{ name: "", description: "", permissions: ["vouchers.create", "reports.sales"], firmId: me.isOwner ? null : companies.length === 1 ? companies[0].id : (me.firmId ?? null) }}
        companies={companies}
        allowShared={me.isOwner}
        allowed={me.isOwner ? ALL_PERMISSIONS : me.permissions}
      />
    </>
  );
}
