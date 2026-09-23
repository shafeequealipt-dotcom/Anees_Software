import { getDb } from "@/db";
import { UserForm } from "@/components/user-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listAllLocations, listCompanies, listRoles } from "@/server/admin";

export const metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requireUser("users.manage");
  const db = await getDb();
  const [roles, companies, locations] = await Promise.all([listRoles(db), listCompanies(db), listAllLocations(db)]);
  return (
    <>
      <PageHeader title="Add user" back={{ href: "/settings/users", label: "Users" }} />
      <UserForm
        roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description, isOwner: r.isOwner, allLocations: can(r, "locations.all") }))}
        companies={companies.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
        locations={locations}
      />
    </>
  );
}
