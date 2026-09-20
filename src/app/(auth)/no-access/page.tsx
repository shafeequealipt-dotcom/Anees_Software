import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "No company access" };

export default async function NoAccessPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.firmId) redirect("/");
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">No company assigned</h1>
      <p className="text-sm text-muted">
        You&apos;re signed in as {user.name}, but you haven&apos;t been given access to any company yet. Ask the owner to open Settings → Users and tick a company for you.
      </p>
      <form action={logoutAction}>
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </div>
  );
}
