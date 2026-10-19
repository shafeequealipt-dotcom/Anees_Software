import { ApiKeys } from "@/components/api-keys";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { VOUCHER_INFO, voucherNumber } from "@/lib/voucher-types";
import { listCompanies } from "@/server/admin";
import { listApiKeys, recentApiEntries } from "@/server/api-keys";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const me = await requireUser("api.manage");
  const db = await getDb();
  const all = (await listCompanies(db, me)).filter((c) => c.active);
  const withApi = await Promise.all(all.map(async (c) => ({ id: c.id, name: c.name, on: (await getSettings(db, c.id)).apiEnabled })));
  const scope = me.isOwner ? ("all" as const) : me.firms.map((f) => f.id);
  const [keys, recent] = await Promise.all([listApiKeys(db, scope), recentApiEntries(db, scope)]);
  return (
    <ApiKeys
      companies={withApi.filter((c) => c.on).map((c) => ({ id: c.id, name: c.name }))}
      offCompanies={withApi.filter((c) => !c.on).map((c) => c.name)}
      currentFirmId={me.firmId}
      keys={keys.map((k) => ({ id: k.id, name: k.name, hint: k.hint, firmName: k.firmName, createdBy: k.createdBy, createdAt: formatDateTime(k.createdAt), lastUsedAt: k.lastUsedAt ? formatDateTime(k.lastUsedAt) : null, revokedAt: k.revokedAt ? formatDateTime(k.revokedAt) : null }))}
      recent={recent.map((r) => ({ id: r.id, firmName: r.firmName, label: VOUCHER_INFO[r.type].label, number: voucherNumber(r), link: `${VOUCHER_INFO[r.type].path}/${r.id}`, date: formatDate(r.date), party: r.partyName, amount: formatMoney(r.totalPaise), status: r.status }))}
    />
  );
}
