import { AccountForm } from "@/components/account-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Add bank account" };

export default async function NewAccountPage() {
  await requireUser("money.edit");
  return (
    <>
      <PageHeader title="Add bank account" back={{ href: "/cash-bank", label: "Cash & bank" }} />
      <AccountForm />
    </>
  );
}
