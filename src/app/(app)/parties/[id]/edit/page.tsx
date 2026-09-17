import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PartyForm } from "@/components/party-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { parties, partyGroups } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Edit party" };

export default async function EditPartyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("masters.edit");
  const { id } = await params;
  const db = await getDb();
  const [p] = await db.select().from(parties).where(eq(parties.id, Number(id) || 0));
  if (!p) notFound();
  const groups = await db.select().from(partyGroups).orderBy(asc(partyGroups.name));
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/parties/${p.id}`, label: p.name }} />
      <PartyForm initial={p} groups={groups} />
    </>
  );
}
