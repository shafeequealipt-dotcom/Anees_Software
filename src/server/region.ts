import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { firms } from "@/db/schema";
import { setRegion, type Region } from "@/lib/region";

/** Read the business's country from the database and make it the active region for this request. */
export async function ensureRegion(): Promise<Region> {
  const db = await getDb();
  const [f] = await db.select({ country: firms.country }).from(firms).where(eq(firms.isDefault, true)).limit(1);
  return setRegion(f?.country);
}
