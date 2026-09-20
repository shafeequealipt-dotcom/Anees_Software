import { asc } from "drizzle-orm";
import { UnitManager } from "@/components/master-lists";
import { getDb } from "@/db";
import { units } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Units" };

export default async function UnitsPage() {
  await requireUser("settings.edit");
  const list = await (await getDb()).select().from(units).orderBy(asc(units.name));
  return <UnitManager units={list} />;
}
