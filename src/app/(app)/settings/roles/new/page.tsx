import { redirect } from "next/navigation";
import { RoleForm } from "@/components/role-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "New role" };

export default async function NewRolePage() {
  const me = await requireUser("users.manage");
  // Roles are shared by every company, so only an owner may change them.
  if (!me.isOwner) redirect("/settings/users");
  return (
    <>
      <PageHeader title="New role" back={{ href: "/settings/roles", label: "Roles & access" }} />
      <RoleForm initial={{ name: "", description: "", permissions: ["vouchers.create", "reports.sales"] }} />
    </>
  );
}
