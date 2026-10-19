import { CompanyManager } from "@/components/company-manager";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listCompanies } from "@/server/admin";
import { partnersEnabled } from "@/server/partners";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const user = await requireUser("companies.manage");
  const db = await getDb();
  const list = await listCompanies(db, user);
  // Only the Owner can turn Partners on or off, so only they need to know which companies have it.
  const partners = user.isOwner ? Object.fromEntries(await Promise.all(list.map(async (c) => [c.id, await partnersEnabled(db, c.id)] as const))) : null;
  const api = user.isOwner ? Object.fromEntries(await Promise.all(list.map(async (c) => [c.id, (await getSettings(db, c.id)).apiEnabled] as const))) : null;
  return <CompanyManager companies={list.map((c) => ({ id: c.id, name: c.name, country: c.country, taxId: c.taxId, active: c.active }))} currentId={user.firmId} partners={partners} api={api} />;
}
