import { CompanyManager } from "@/components/company-manager";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listCompanies } from "@/server/admin";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const user = await requireUser("companies.manage");
  const list = await listCompanies(await getDb());
  return <CompanyManager companies={list.map((c) => ({ id: c.id, name: c.name, country: c.country, taxId: c.taxId, active: c.active }))} currentId={user.firmId} />;
}
