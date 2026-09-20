import { JournalForm } from "@/components/accounting-forms";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listGlAccounts } from "@/server/gl";

export const metadata = { title: "New journal entry" };

export default async function NewJournalPage() {
  const user = await requireUser("accounting.edit");
  const accounts = (await listGlAccounts(await getDb(), user.firmId)).filter((a) => a.active);
  return <JournalForm accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} />;
}
