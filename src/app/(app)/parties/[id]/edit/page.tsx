import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PartyForm } from "@/components/party-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { parties, partyGroups } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { listPriceLists } from "@/server/pricing";
import { can } from "@/lib/permissions";

export const metadata = { title: "Edit party" };

export default async function EditPartyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("masters.edit");
  const hideContact = !can(user, "see.partyContact");
  const hideBalance = !can(user, "see.partyBalance");
  const { id } = await params;
  const db = await getDb();
  const [p] = await db.select().from(parties).where(and(eq(parties.id, Number(id) || 0), eq(parties.firmId, user.firmId)));
  if (!p) notFound();
  const priceLists = await listPriceLists(db, user.firmId);
  const groups = await db.select().from(partyGroups).where(eq(partyGroups.firmId, user.firmId)).orderBy(asc(partyGroups.name));
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} back={{ href: `/parties/${p.id}`, label: p.name }} />
      <PartyForm
        initial={{
          ...p,
          ...(hideContact ? { phone: null, email: null, gstin: null, stateCode: null, billingAddress: null, shippingAddress: null } : {}),
          ...(hideBalance ? { openingBalancePaise: 0, openingDate: null, creditLimitPaise: null } : {}),
        }}
        groups={groups}
        priceLists={priceLists.filter((l) => l.active)}
        hideContact={hideContact}
        hideBalance={hideBalance}
      />
    </>
  );
}
