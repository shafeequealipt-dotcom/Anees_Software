import { redirect } from "next/navigation";
import { pendingMfaUser } from "@/lib/auth";
import { CodeForm } from "./code-form";

export const metadata = { title: "Enter code" };
export const dynamic = "force-dynamic";

export default async function CodePage() {
  const user = await pendingMfaUser();
  if (!user) redirect("/login");
  return (
    <div className="rounded-xl border border-line bg-panel p-7 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink">Enter your 6-digit code</h1>
      <p className="mt-1 text-sm text-muted">
        Open your authenticator app (Google Authenticator, Microsoft Authenticator…) and type the code shown for this account, {user.email}.
      </p>
      <CodeForm />
    </div>
  );
}
