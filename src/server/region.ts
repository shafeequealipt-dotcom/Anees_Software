import "server-only";
import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { firms } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { setRegion, type Region } from "@/lib/region";

/** Make the signed-in user's current company the active region (currency, tax wording). Signed-out pages use the first company. */
export async function ensureRegion(): Promise<Region> {
  const user = await currentUser();
  if (user && user.firmId) return setRegion(user.firm.country);
  const db = await getDb();
  const [f] = await db.select({ country: firms.country }).from(firms).orderBy(asc(firms.id)).limit(1);
  return setRegion(f?.country);
}
