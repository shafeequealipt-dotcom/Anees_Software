import { ApiKeys } from "@/components/api-keys";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { listCompanies } from "@/server/admin";
import { listApiKeys } from "@/server/api-keys";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const me = await requireUser("api.manage");
  const db = await getDb();
  const companies = (await listCompanies(db, me)).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  const keys = await listApiKeys(db, me.isOwner ? "all" : me.firms.map((f) => f.id));
  return (
    <ApiKeys
      companies={companies}
      currentFirmId={me.firmId}
      keys={keys.map((k) => ({ id: k.id, name: k.name, hint: k.hint, firmName: k.firmName, createdBy: k.createdBy, createdAt: formatDateTime(k.createdAt), lastUsedAt: k.lastUsedAt ? formatDateTime(k.lastUsedAt) : null, revokedAt: k.revokedAt ? formatDateTime(k.revokedAt) : null }))}
    />
  );
}
