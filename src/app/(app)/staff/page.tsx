import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { LinkButton, Money, PageHeader, cx } from "@/components/ui";
import { AdjustButton, PayButton } from "@/components/staff";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { monthLabel, monthSchema, salarySheet, shiftMonth } from "@/server/staff";

export const metadata = { title: "Staff & salaries" };

const AVATAR = ["bg-brand-100 text-brand-700", "bg-accent-100 text-accent-600", "bg-good-bg text-good", "bg-sky-100 text-sky-700", "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700"];
const avatarClass = (name: string) => AVATAR[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR.length];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser("staff.manage");
  const sp = await searchParams;
  const today = todayIST();
  const thisMonth = today.slice(0, 7);
  const month = monthSchema.safeParse(sp.month).success ? sp.month! : thisMonth;
  const db = await getDb();
  const sheet = await salarySheet(db, user.firmId, month);
  const accts = await db.select({ id: accounts.id, name: accounts.name, kind: accounts.kind, isDefault: accounts.isDefault }).from(accounts).where(and(eq(accounts.firmId, user.firmId), eq(accounts.active, true))).orderBy(asc(accounts.kind), asc(accounts.name));
  const defaultAccountId = (accts.find((a) => a.isDefault) ?? accts[0])?.id ?? null;
  const accountOpts = accts.map((a) => ({ id: a.id, name: a.name }));
  // Pay dates default to today when looking at this month, otherwise to the last day of that month.
  const payDate = month === thisMonth ? today : month < thisMonth ? `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()}` : today;
  const label = monthLabel(month);
  const t = sheet.totals;
  const settled = t.paidPaise + t.advancePaise;
  const nav = (m: string) => (m === thisMonth ? "/staff" : `/staff?month=${m}`);

  return (
    <>
      <PageHeader
        title="Staff & salaries"
        subtitle={`${sheet.rows.length} ${sheet.rows.length === 1 ? "person" : "people"} on the ${label} salary sheet`}
        actions={
          <>
            <LinkButton href="/staff/all" variant="secondary">
              All staff
            </LinkButton>
            <LinkButton href="/staff/new" variant="primary">
              + Add employee
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Link href={nav(shiftMonth(month, -1))} className="flex size-9 items-center justify-center rounded-lg border border-line bg-panel text-muted hover:border-brand-200 hover:text-ink" aria-label="Previous month">
          ‹
        </Link>
        <div className="min-w-44 rounded-lg border border-line bg-panel px-4 py-1.5 text-center text-sm font-semibold text-ink">{label}</div>
        <Link href={nav(shiftMonth(month, 1))} className="flex size-9 items-center justify-center rounded-lg border border-line bg-panel text-muted hover:border-brand-200 hover:text-ink" aria-label="Next month">
          ›
        </Link>
        {month !== thisMonth && (
          <Link href="/staff" className="ml-1 text-sm text-brand-600 hover:underline">
            This month
          </Link>
        )}
      </div>

      {sheet.rows.length > 0 && (
        <section className="mb-4 rounded-xl border border-line bg-panel px-4 py-4 shadow-sm shadow-ink/[0.03] sm:px-5">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <div className="text-xs font-medium text-muted">Salaries for {label}</div>
              <div className="num mt-0.5 text-2xl font-semibold tracking-tight text-ink">
                <Money paise={t.earnedPaise} />
              </div>
              <div className="mt-0.5 text-xs text-faint">after extra pay and deductions</div>
            </div>
            <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:gap-8">
              <Figure dot="bg-brand-500" label="Advances" paise={t.advancePaise} tone="text-brand-700" />
              <Figure dot="bg-good" label="Paid" paise={t.paidPaise} tone="text-good" />
              <Figure dot="bg-accent-500" label="Still due" paise={t.duePaise} tone={t.duePaise > 0 ? "text-accent-600" : "text-faint"} />
            </div>
          </div>
          {t.earnedPaise > 0 && (
            <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-accent-100" title={`${Math.round((Math.min(settled, t.earnedPaise) / t.earnedPaise) * 100)}% settled`}>
              <div className="h-full bg-brand-500" style={{ width: `${(Math.min(t.advancePaise, t.earnedPaise) / t.earnedPaise) * 100}%` }} />
              <div className="h-full bg-good" style={{ width: `${(Math.min(t.paidPaise, Math.max(0, t.earnedPaise - t.advancePaise)) / t.earnedPaise) * 100}%` }} />
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
        {sheet.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-brand-50 text-xl text-brand-600" aria-hidden="true">
              ☺
            </div>
            <p className="font-medium text-ink">No one on the salary sheet for {label}</p>
            <p className="max-w-sm text-sm text-muted">Add the people you pay every month. Their advances and salary payments are recorded as expenses automatically.</p>
            <div className="mt-2">
              <LinkButton href="/staff/new" variant="primary">
                + Add employee
              </LinkButton>
            </div>
          </div>
        ) : (
          <div className="rounded-xl">
            <table className="w-full border-collapse text-sm max-md:table-fixed">
              <thead className="max-md:hidden">
                <tr className="text-left text-xs font-medium text-faint">
                  <th className="px-4 py-2.5 font-medium sm:pl-5">Employee</th>
                  <th className="px-3 py-2.5 text-right font-medium">Salary</th>
                  <th className="px-3 py-2.5 text-right font-medium">Extra / less</th>
                  <th className="px-3 py-2.5 text-right font-medium">Advances</th>
                  <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                  <th className="px-3 py-2.5 text-right font-medium">Due</th>
                  <th className="px-4 py-2.5 sm:pr-5" />
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => {
                  const adj = r.extraPaise - r.deductionPaise;
                  const status = r.duePaise === 0 && r.earnedPaise > 0 ? "paid" : r.duePaise < 0 ? "over" : "due";
                  const pay = (
                    <div className="flex justify-end gap-1.5">
                      {/* Phones: just Pay, so the name has room; advances are one tap away on the person's page. */}
                      <div className="max-md:hidden">
                      <PayButton employeeId={r.employeeId} name={r.name} month={month} monthLabel={label} kind="advance" suggestPaise={0} accounts={accountOpts} defaultAccountId={defaultAccountId} today={payDate} label="Advance" variant="ghost" />
                      </div>
                      {r.duePaise > 0 ? (
                        <PayButton employeeId={r.employeeId} name={r.name} month={month} monthLabel={label} kind="salary" suggestPaise={r.duePaise} dueLabel={formatMoney(r.duePaise)} accounts={accountOpts} defaultAccountId={defaultAccountId} today={payDate} label="Pay" variant="primary" />
                      ) : (
                        <span className={cx("inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold", status === "paid" ? "bg-good-bg text-good" : status === "over" ? "bg-warn-bg text-warn" : "bg-ground text-faint")}>
                          {status === "paid" ? "Paid" : status === "over" ? `${formatMoney(-r.duePaise)} extra` : "—"}
                        </span>
                      )}
                    </div>
                  );
                  return (
                    <tr key={r.employeeId} className="border-t border-line/70 align-middle transition-colors hover:bg-brand-50/30">
                      <td className="px-4 py-3 sm:pl-5">
                        <div className="flex items-center gap-2.5 sm:gap-3">
                          <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:size-9", avatarClass(r.name))}>{initials(r.name)}</span>
                          <div className="min-w-0 flex-1">
                            <Link href={`/staff/${r.employeeId}`} className="block truncate font-medium text-ink hover:text-brand-700">
                              {r.name}
                              {!r.active && <span className="ml-1.5 text-xs font-normal text-faint">(left)</span>}
                            </Link>
                            <div className="truncate text-xs text-faint">{[r.role, r.locationName].filter(Boolean).join(" · ") || "—"}</div>
                            {/* Phones: the numbers that matter, under the name. */}
                            <div className="mt-0.5 text-xs text-muted md:hidden">
                              Due <Money paise={Math.max(0, r.duePaise)} className="font-semibold text-ink" />
                              {r.advancePaise > 0 && (
                                <>
                                  {" · advance "}
                                  <Money paise={r.advancePaise} />
                                </>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 md:hidden">{pay}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right max-md:hidden">
                        <Money paise={r.salaryPaise} />
                      </td>
                      <td className="px-1 py-3 text-right max-md:hidden">
                        <AdjustButton
                          employeeId={r.employeeId}
                          month={month}
                          extraPaise={r.extraPaise}
                          deductionPaise={r.deductionPaise}
                          note={r.note}
                          display={adj === 0 ? <span className="text-faint">+ add</span> : <span className={adj > 0 ? "text-good" : "text-bad"}>{adj > 0 ? "+" : "−"}{formatMoney(Math.abs(adj))}</span>}
                        />
                      </td>
                      <td className="px-3 py-3 text-right text-brand-700 max-md:hidden">
                        <Money paise={r.advancePaise} blankZero />
                      </td>
                      <td className="px-3 py-3 text-right text-good max-md:hidden">
                        <Money paise={r.paidPaise} blankZero />
                      </td>
                      <td className={cx("px-3 py-3 text-right font-semibold max-md:hidden", r.duePaise > 0 ? "text-accent-600" : "text-faint")}>
                        <Money paise={Math.max(0, r.duePaise)} />
                      </td>
                      <td className="px-4 py-3 max-md:hidden sm:pr-5">{pay}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mt-3 text-xs text-faint">
        Every advance and salary payment is saved as a &ldquo;Salaries &amp; wages&rdquo; expense, so it&apos;s already in your cash, bank and profit &amp; loss. Advances given in a month are taken off that month&apos;s salary.
      </p>
    </>
  );
}

function Figure({ dot, label, paise, tone }: { dot: string; label: string; paise: number; tone: string }) {
  // Phones: one line each, label left and amount right; wider screens: side by side.
  return (
    <div className="flex items-center justify-between sm:block">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className={cx("size-2 rounded-full", dot)} />
        {label}
      </div>
      <div className={cx("num text-sm font-semibold sm:mt-0.5 sm:text-lg", tone)}>
        <Money paise={paise} />
      </div>
    </div>
  );
}
