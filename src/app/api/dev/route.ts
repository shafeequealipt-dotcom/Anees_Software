import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { seedDemo } from "@/server/demo";

/**
 * Development helper: load sample data and sign in as the demo owner without a password.
 * Disabled unless running `next dev` against the local embedded database.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.DATABASE_URL) {
    return new Response("Not found", { status: 404 });
  }
  const db = await getDb();
  await seedDemo(db);
  const [owner] = await db.select().from(users).where(eq(users.role, "owner"));
  if (!owner) return new Response("No owner", { status: 500 });
  await createSession(owner.id, true);
  const to = new URL(req.url).searchParams.get("to") ?? "/";
  redirect(to.startsWith("/") ? to : "/");
}
