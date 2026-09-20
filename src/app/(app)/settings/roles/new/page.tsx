import { RoleForm } from "@/components/role-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "New role" };

export default async function NewRolePage() {
  await requireUser("users.manage");
  return (
    <>
      <PageHeader title="New role" back={{ href: "/settings/roles", label: "Roles & access" }} />
      <RoleForm initial={{ name: "", description: "", permissions: ["vouchers.create", "reports.sales"] }} />
    </>
  );
}
