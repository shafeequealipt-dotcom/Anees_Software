import { notFound } from "next/navigation";
import { EmployeeForm } from "@/components/staff";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listLocations } from "@/server/locations";
import { getEmployee } from "@/server/staff";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("staff.manage");
  const db = await getDb();
  const e = await getEmployee(db, user.firmId, Number((await params).id) || 0);
  if (!e) notFound();
  const locs = (await listLocations(db, user.firmId)).filter((l) => l.kind === "shop" || l.kind === "warehouse");
  return (
    <>
      <PageHeader title={`Edit ${e.name}`} back={{ href: `/staff/${e.id}`, label: e.name }} />
      <EmployeeForm initial={e} locations={locs.map((l) => ({ id: l.id, name: l.name }))} />
    </>
  );
}
