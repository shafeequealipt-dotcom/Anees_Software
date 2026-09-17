import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { currentUser } from "@/lib/auth";
import { needsSetup } from "@/server/setup";
import { businessName } from "../../actions/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ demo_email?: string; demo_password?: string }> }) {
  const db = await getDb();
  if (await needsSetup(db)) redirect("/setup");
  if (await currentUser()) redirect("/");
  const name = await businessName();
  const sp = await searchParams;
  // Only ever set by the dev-only /api/dev route, which 404s outside local development.
  const demo = process.env.NODE_ENV === "development" && sp.demo_email && sp.demo_password ? { email: sp.demo_email, password: sp.demo_password } : null;
  return (
    <div className="rounded-xl border border-line bg-panel p-7 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{name}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use the email and password your owner set up for you.</p>
      {demo && (
        <div className="mt-4 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
          <p className="font-medium">Local test login (filled in below)</p>
          <p className="mt-0.5 font-mono text-xs">
            {demo.email} / {demo.password}
          </p>
        </div>
      )}
      <LoginForm defaultEmail={demo?.email} defaultPassword={demo?.password} />
    </div>
  );
}
