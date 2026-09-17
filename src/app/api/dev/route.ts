import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from "@/server/demo";

/**
 * Development helper: load sample data. Disabled unless running `next dev` against
 * the local embedded database.
 *
 *   /api/dev            seed the data, then go to /login so the sign-in screen can be
 *                        tried for real with the printed demo credentials
 *   /api/dev?login=1    seed the data and sign straight in, skipping the login screen
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.DATABASE_URL) {
    return new Response("Not found", { status: 404 });
  }
  const db = await getDb();
  await seedDemo(db);
  const url = new URL(req.url);
  if (url.searchParams.get("login") === "1") {
    const [owner] = await db.select().from(users).where(eq(users.role, "owner"));
    if (!owner) return new Response("No owner", { status: 500 });
    await createSession(owner.id, true);
    const to = url.searchParams.get("to") ?? "/";
    redirect(to.startsWith("/") ? to : "/");
  }
  redirect(`/login?demo_email=${encodeURIComponent(DEMO_EMAIL)}&demo_password=${encodeURIComponent(DEMO_PASSWORD)}`);
}
