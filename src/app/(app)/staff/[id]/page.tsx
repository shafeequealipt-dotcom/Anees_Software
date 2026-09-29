import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { PayButton } from "@/components/staff";
import { Badge, LinkButton, Money, PageHeader, cx } from "@/components/ui";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { employeePayments, getEmployee, monthLabel, salarySheet } from "@/server/staff";

export const metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("staff.manage");
  const db = await getDb();
  const e = await getEmployee(db, user.firmId, Number((await params).id) || 0);
  if (!e) notFound();
  const today = todayIST();
  const month = today.slice(0, 7);
  const row = (await salarySheet(db, user.firmId, month)).rows.find((r) => r.employeeId === e.id);
  const history = await employeePayments(db, user.firmId, e.id);
  const accts = await db.select({ id: accounts.id, name: accounts.name, isDefault: accounts.isDefault }).from(accounts).where(and(eq(accounts.firmId, user.firmId), eq(accounts.active, true))).orderBy(asc(accounts.kind), asc(accounts.name));
  const accountOpts = accts.map((a) => ({ id: a.id, name: a.name }));
  const defaultAccountId = (accts.find((a) => a.isDefault) ?? accts[0])?.id ?? null;
  const active = history.filter((h) => h.status === "active");
  const totalPaid = active.reduce((s, h) => s + h.totalPaise, 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {e.name}
            {!e.active && <Badge>Left</Badge>}
          </span>
        }
        subtitle={[e.role, e.locationName, e.phone].filter(Boolean).join(" · ") || undefined}
        back={{ href: "/staff", label: "Staff & salaries" }}
        actions={
          <>
            <LinkButton href={`/staff/${e.id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            {e.active && (
              <>
                <PayButton employeeId={e.id} name={e.name} month={month} monthLabel={monthLabel(month)} kind="advance" suggestPaise={0} accounts={accountOpts} defaultAccountId={defaultAccountId} today={today} label="Give advance" />
                {row && row.duePaise > 0 && (
                  <PayButton employeeId={e.id} name={e.name} month={month} monthLabel={monthLabel(month)} kind="salary" suggestPaise={row.duePaise} dueLabel={formatMoney(row.duePaise)} accounts={accountOpts} defaultAccountId={defaultAccountId} today={today} label={`Pay ${monthLabel(month).split(" ")[0]} salary`} variant="primary" />
                )}
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Tile label="Monthly salary" value={<Money paise={e.monthlySalaryPaise} />} />
        <Tile label={`Due for ${monthLabel(month)}`} value={<Money paise={Math.max(0, row?.duePaise ?? 0)} />} tone={row && row.duePaise > 0 ? "text-accent-600" : undefined} />
        <Tile label={`Advance in ${monthLabel(month).split(" ")[0]}`} value={<Money paise={row?.advancePaise ?? 0} />} tone="text-brand-700" />
        <Tile label="Paid in total" value={<Money paise={totalPaid} />} hint={e.joinedOn ? `since ${formatDate(e.joinedOn)}` : undefined} />
      </div>

      <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink sm:px-5">Payments</div>
        {history.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Nothing paid yet. Advances and salary payments show up here.</p>
        ) : (
          <div className="overflow-x-auto rounded-b-xl">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-faint">
                  <th className="px-4 py-2.5 font-medium sm:pl-5">Date</th>
                  <th className="px-3 py-2.5 font-medium">For</th>
                  <th className="px-3 py-2.5 font-medium max-sm:hidden">Paid from</th>
                  <th className="px-4 py-2.5 text-right font-medium sm:pr-5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className={cx("border-t border-line/70", h.status === "cancelled" && "opacity-55")}>
                    <td className="px-4 py-3 sm:pl-5">
                      <Link href={`/expenses/${h.id}`} className="font-medium text-ink hover:text-brand-700">
                        {formatDate(h.date)}
                      </Link>
                      <div className="text-xs text-faint">
                        {h.prefix}
                        {h.number}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cx("mr-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", h.payKind === "advance" ? "bg-brand-50 text-brand-700" : "bg-good-bg text-good")}>{h.payKind === "advance" ? "Advance" : "Salary"}</span>
                      <span className="text-muted">{h.payMonth ? monthLabel(h.payMonth) : ""}</span>
                      {h.status === "cancelled" && <span className="ml-2 text-xs text-faint">cancelled</span>}
                      {h.notes && <div className="text-xs text-faint">{h.notes}</div>}
                    </td>
                    <td className="px-3 py-3 text-muted max-sm:hidden">
                      {h.accountName}
                      {h.paymentMode && <span className="text-xs text-faint"> · {h.paymentMode}</span>}
                    </td>
                    <td className={cx("px-4 py-3 text-right font-semibold sm:pr-5", h.status === "cancelled" && "line-through")}>
                      <Money paise={h.totalPaise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {e.notes && <p className="mt-3 whitespace-pre-line rounded-xl border border-line bg-panel px-5 py-3 text-sm text-muted">{e.notes}</p>}
    </>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 shadow-sm shadow-ink/[0.03]">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx("num mt-1 text-lg font-semibold", tone ?? "text-ink")}>{value}</div>
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </div>
  );
}
