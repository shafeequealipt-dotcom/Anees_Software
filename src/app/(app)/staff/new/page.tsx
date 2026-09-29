import { EmployeeForm } from "@/components/staff";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listLocations } from "@/server/locations";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requireUser("staff.manage");
  const locs = (await listLocations(await getDb(), user.firmId)).filter((l) => l.kind === "shop" || l.kind === "warehouse");
  return (
    <>
      <PageHeader title="Add employee" back={{ href: "/staff", label: "Staff & salaries" }} />
      <EmployeeForm locations={locs.map((l) => ({ id: l.id, name: l.name }))} />
    </>
  );
}
