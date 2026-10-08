import { PartnerForm } from "@/components/partners";
import { PageHeader } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { nextPartnerCode } from "@/server/partners";
import { requirePartnersUser } from "@/server/partners-page";

export const metadata = { title: "Add partner" };

export default async function NewPartnerPage() {
  const { user, db } = await requirePartnersUser();
  const [nextCode, cfg] = await Promise.all([nextPartnerCode(db, user.firmId), getSettings(db, user.firmId)]);
  return (
    <>
      <PageHeader title="Add partner" back={{ href: "/partners", label: "Partners" }} />
      <PartnerForm nextCode={nextCode} defaultRatePaise={cfg.payoutRatePerMillionPaise} />
    </>
  );
}
