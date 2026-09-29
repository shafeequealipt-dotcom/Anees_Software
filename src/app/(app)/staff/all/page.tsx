import Link from "next/link";
import { LinkButton, Money, PageHeader, cx } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { listEmployees } from "@/server/staff";

export const metadata = { title: "All staff" };

/** Everyone ever employed, including people who have left (the salary sheet only shows a month's staff). */
export default async function AllStaffPage() {
  const user = await requireUser("staff.manage");
  const list = await listEmployees(await getDb(), user.firmId, { includeInactive: true });
  const current = list.filter((e) => e.active);
  const former = list.filter((e) => !e.active);
  const payroll = current.reduce((s, e) => s + e.monthlySalaryPaise, 0);

  return (
    <>
      <PageHeader
        title="All staff"
        subtitle={`${current.length} working now${former.length ? ` · ${former.length} left` : ""}`}
        back={{ href: "/staff", label: "Salary sheet" }}
        actions={
          <LinkButton href="/staff/new" variant="primary">
            + Add employee
          </LinkButton>
        }
      />
      <p className="-mt-4 mb-4 text-sm text-muted">
        Monthly payroll <Money paise={payroll} className="font-semibold text-ink" />
      </p>
      {[
        { title: "Working now", rows: current },
        { title: "Left", rows: former },
      ]
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <section key={g.title} className="mb-4 rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink sm:px-5">{g.title}</div>
            <ul>
              {g.rows.map((e) => (
                <li key={e.id} className={cx("border-t border-line/70 first:border-t-0", !e.active && "opacity-70")}>
                  <Link href={`/staff/${e.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-50/30 sm:px-5">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{e.name}</div>
                      <div className="truncate text-xs text-faint">
                        {[e.role, e.locationName].filter(Boolean).join(" · ") || "—"}
                        {e.joinedOn && ` · joined ${formatDate(e.joinedOn)}`}
                        {e.leftOn && ` · left ${formatDate(e.leftOn)}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money paise={e.monthlySalaryPaise} className="font-semibold text-ink" />
                      <div className="text-xs text-faint">a month</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {list.length === 0 && (
        <div className="rounded-xl border border-line bg-panel px-6 py-12 text-center text-sm text-muted">
          No staff yet. <Link href="/staff/new" className="text-brand-600 hover:underline">Add the first one.</Link>
        </div>
      )}
    </>
  );
}
