import { and, asc, eq } from "drizzle-orm";
import { PartyForm } from "@/components/party-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { partyGroups } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Add party" };

export default async function NewPartyPage() {
  const user = await requireUser("masters.edit");
  const db = await getDb();
  const groups = await db.select().from(partyGroups).where(eq(partyGroups.firmId, user.firmId)).orderBy(asc(partyGroups.name));
  return (
    <>
      <PageHeader title="Add party" back={{ href: "/parties", label: "Parties" }} />
      <PartyForm groups={groups} />
    </>
  );
}
