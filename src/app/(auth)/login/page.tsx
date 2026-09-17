import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { currentUser } from "@/lib/auth";
import { needsSetup } from "@/server/setup";
import { businessName } from "../../actions/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const db = await getDb();
  if (await needsSetup(db)) redirect("/setup");
  if (await currentUser()) redirect("/");
  const name = await businessName();
  return (
    <div className="rounded-xl border border-line bg-panel p-7 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{name}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use the email and password your owner set up for you.</p>
      <LoginForm />
    </div>
  );
}
