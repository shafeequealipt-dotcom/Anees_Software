import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AccountForm } from "@/components/account-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Edit account" };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("money.edit");
  const { id } = await params;
  const db = await getDb();
  const [a] = await db.select().from(accounts).where(eq(accounts.id, Number(id) || 0));
  if (!a) notFound();
  return (
    <>
      <PageHeader title={`Edit ${a.name}`} back={{ href: `/cash-bank/${a.id}`, label: a.name }} />
      <AccountForm initial={a} />
    </>
  );
}
