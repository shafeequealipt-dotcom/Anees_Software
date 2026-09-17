import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { checkSetupToken } from "@/lib/auth";
import { GST_STATES } from "@/lib/gst/states";
import { needsSetup } from "@/server/setup";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up your business" };
export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const db = await getDb();
  if (!(await needsSetup(db))) redirect("/login");
  const { token } = await searchParams;
  const valid = checkSetupToken(token);
  return (
    <div className="rounded-xl border border-line bg-panel p-7 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink">Set up your business</h1>
      <p className="mt-1 text-sm text-muted">This runs once. You become the owner and can add staff afterwards.</p>
      {valid ? (
        <SetupForm token={token ?? ""} states={GST_STATES} />
      ) : (
        <p className="mt-6 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">
          Open the setup link printed by <code className="font-mono">sudo billing setup-link</code> on the server.
        </p>
      )}
    </div>
  );
}
