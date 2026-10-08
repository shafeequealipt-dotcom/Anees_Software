import { notFound } from "next/navigation";
import { PartnerForm } from "@/components/partners";
import { PageHeader } from "@/components/ui";
import { getPartner, payeeName } from "@/server/partners";
import { requirePartnersUser } from "@/server/partners-page";

export const metadata = { title: "Edit partner" };

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, db } = await requirePartnersUser();
  const p = await getPartner(db, user.firmId, Number((await params).id) || 0);
  if (!p) notFound();
  const { firmId: _firmId, createdAt: _c, updatedAt: _u, ...value } = p;
  void _firmId, _c, _u;
  return (
    <>
      <PageHeader title={`Edit ${payeeName(p)}`} back={{ href: `/partners/${p.id}`, label: payeeName(p) }} />
      <PartnerForm initial={value} nextCode={p.code} defaultRatePaise={0} />
    </>
  );
}
