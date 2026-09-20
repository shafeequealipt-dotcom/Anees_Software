import { ChangePasswordForm } from "@/components/change-password-form";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My account</h1>
        <p className="text-sm text-muted">
          {user.name} · {user.email} · {user.roleName}
        </p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
