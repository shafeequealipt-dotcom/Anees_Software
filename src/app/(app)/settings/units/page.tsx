import { and, asc, eq } from "drizzle-orm";
import { UnitManager } from "@/components/master-lists";
import { getDb } from "@/db";
import { units } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Units" };

export default async function UnitsPage() {
  const user = await requireUser("settings.edit");
  const list = await (await getDb()).select().from(units).where(eq(units.firmId, user.firmId)).orderBy(asc(units.name));
  return <UnitManager units={list} />;
}
