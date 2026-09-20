import { eq, and, asc } from "drizzle-orm";
import { AssetsManager } from "@/components/accounting-forms";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayIST } from "@/lib/dates";
import { listAssets, pendingDepreciationYears } from "@/server/gl";

export const metadata = { title: "Fixed assets" };

export default async function AssetsPage() {
  const user = await requireUser("accounting.view");
  const db = await getDb();
  const [assets, pending, cash] = await Promise.all([
    listAssets(db, user.firmId),
    pendingDepreciationYears(db, user.firmId, todayIST()),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(and(eq(accounts.firmId, user.firmId), eq(accounts.active, true))).orderBy(asc(accounts.kind), asc(accounts.name)),
  ]);
  const editable = can(user, "accounting.edit");
  return (
    <AssetsManager
      assets={assets.map((a) => ({ id: a.id, name: a.name, category: a.category, purchaseDate: a.purchaseDate, costPaise: a.costPaise, method: a.method, rateBp: a.rateBp, accumulatedPaise: a.accumulatedPaise, bookValuePaise: a.bookValuePaise, disposedOn: a.disposedOn }))}
      pending={editable ? pending.map((y) => ({ label: y.label, from: y.from, assets: y.assets })) : []}
      cashAccounts={editable ? cash : []}
      editable={editable}
    />
  );
}
