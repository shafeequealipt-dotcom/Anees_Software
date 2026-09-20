import { and, eq } from "drizzle-orm";
import { BusinessForm } from "@/components/business-form";
import { getDb } from "@/db";
import { firms } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Business settings" };

export default async function BusinessSettingsPage() {
  const user = await requireUser("settings.edit");
  const db = await getDb();
  const [f] = await db.select().from(firms).where(eq(firms.id, user.firmId));
  return <BusinessForm initial={{ ...f, createdAt: undefined, updatedAt: undefined } as never} />;
}
