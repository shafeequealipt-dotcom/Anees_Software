import Link from "next/link";
import { PartnerGrowthCharts, PartnerGrowthTiles } from "@/components/partner-growth";
import { LinkButton, PageHeader } from "@/components/ui";
import { todayIST } from "@/lib/dates";
import { partnerGrowth } from "@/server/partners";
import { requirePartnersUser } from "@/server/partners-page";
import { monthLabel } from "@/server/staff";

export const metadata = { title: "Partners overview" };

/** How many partners there are and how the list has grown, month by month. */
export default async function PartnersOverviewPage() {
  const { user, db } = await requirePartnersUser();
  const today = todayIST();
  const g = await partnerGrowth(db, user.firmId, today);

  return (
    <>
      <PageHeader
        title="Partners overview"
        subtitle="How many partners you have and how the list has grown over the last 12 months"
        back={{ href: "/partners", label: "Partners" }}
        actions={
          <>
            <LinkButton href="/partners/all" variant="secondary">
              All partners
            </LinkButton>
            <LinkButton href="/partners/new" variant="primary">
              + Add partner
            </LinkButton>
          </>
        }
      />
      {g.total === 0 ? (
        <div className="rounded-xl border border-line bg-panel px-6 py-12 text-center text-sm text-muted">
          No partners yet. <Link href="/partners/new" className="text-brand-600 hover:underline">Add the first one</Link> and the numbers appear here.
        </div>
      ) : (
        <>
          <PartnerGrowthTiles total={g.total} active={g.active} national={g.national} international={g.international} addedThisMonth={g.addedThisMonth} addedLastMonth={g.addedLastMonth} monthName={monthLabel(today.slice(0, 7)).split(" ")[0]} />
          <PartnerGrowthCharts months={g.months} />
          <p className="mt-3 text-xs text-faint">A partner is counted from the day they joined, or from the day they were added here when no joining date was given. Inactive partners stay in the totals.</p>
        </>
      )}
    </>
  );
}
