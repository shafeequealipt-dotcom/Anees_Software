import { PriceListManager } from "@/components/pricing-panels";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listPriceLists } from "@/server/pricing";

export const metadata = { title: "Price lists" };

export default async function PriceListsPage() {
  const user = await requireUser("settings.edit");
  const lists = await listPriceLists(await getDb(), user.firmId);
  return <PriceListManager lists={lists.map((l) => ({ id: l.id, name: l.name, active: l.active }))} />;
}
