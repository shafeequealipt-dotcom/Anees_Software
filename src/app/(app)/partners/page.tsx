import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { InvoiceButton, PayPartnerButton, PayoutSettingsForm, PromotionsButton, ShareInvoiceButton, ViewsButton } from "@/components/partners";
import { LinkButton, Money, PageHeader, cx } from "@/components/ui";
import { accounts } from "@/db/schema";
import { todayIST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { groupViews } from "@/lib/payout";
import { getSettings } from "@/lib/settings";
import { payeeName, partnerSheet } from "@/server/partners";
import { requirePartnersUser } from "@/server/partners-page";
import { monthLabel, monthSchema, shiftMonth } from "@/server/staff";

export const metadata = { title: "Partners" };

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { user, db } = await requirePartnersUser();
  const sp = await searchParams;
  const today = todayIST();
  const thisMonth = today.slice(0, 7);
  const month = monthSchema.safeParse(sp.month).success ? sp.month! : thisMonth;
  const sheet = await partnerSheet(db, user.firmId, month);
  const cfg = await getSettings(db, user.firmId);
  const accts = await db.select({ id: accounts.id, name: accounts.name, kind: accounts.kind, isDefault: accounts.isDefault }).from(accounts).where(and(eq(accounts.firmId, user.firmId), eq(accounts.active, true))).orderBy(asc(accounts.kind), asc(accounts.name));
  const defaultAccountId = (accts.find((a) => a.isDefault) ?? accts[0])?.id ?? null;
  const accountOpts = accts.map((a) => ({ id: a.id, name: a.name }));
  const payDate = month === thisMonth ? today : month < thisMonth ? `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()}` : today;
  const label = monthLabel(month);
  const t = sheet.totals;
  const nav = (m: string) => (m === thisMonth ? "/partners" : `/partners?month=${m}`);

  return (
    <>
      <PageHeader
        title="Partners"
        subtitle={`${sheet.rows.length} ${sheet.rows.length === 1 ? "partner" : "partners"} on the ${label} sheet`}
        actions={
          <>
            <LinkButton href="/partners/all" variant="secondary">
              All partners
            </LinkButton>
            {sheet.rows.some((r) => r.totalPaise > 0 || r.paidPaise > 0) && (
              <a href={`/api/export/partners?month=${month}`} className="inline-flex h-9 items-center rounded-lg border border-line bg-panel px-3 text-sm font-medium text-ink hover:bg-ground">
                Download Excel
              </a>
            )}
            <LinkButton href="/partners/new" variant="primary">
              + Add partner
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
          <Link href="/partners" className="ml-1 text-sm text-brand-600 hover:underline">
            This month
          </Link>
        )}
      </div>

      {t.totalPaise > 0 && (
        <section className="mb-4 rounded-xl border border-line bg-panel px-4 py-4 shadow-sm shadow-ink/[0.03] sm:px-5">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <div className="text-xs font-medium text-muted">Payable to partners for {label}</div>
              <div className="num mt-0.5 text-2xl font-semibold tracking-tight text-ink">
                <Money paise={t.totalPaise} />
              </div>
              <div className="mt-0.5 text-xs text-faint">views plus promotions</div>
            </div>
            <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:gap-8">
              <Figure dot="bg-good" label="Paid" paise={t.paidPaise} tone="text-good" />
              <Figure dot="bg-accent-500" label="Still due" paise={t.duePaise} tone={t.duePaise > 0 ? "text-accent-600" : "text-faint"} />
            </div>
          </div>
          <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-accent-100" title={`${Math.round((Math.min(t.paidPaise, t.totalPaise) / t.totalPaise) * 100)}% paid`}>
            <div className="h-full bg-good" style={{ width: `${(Math.min(t.paidPaise, t.totalPaise) / t.totalPaise) * 100}%` }} />
          </div>
        </section>
      )}

      <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
        {sheet.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <p className="font-medium text-ink">No partners on the sheet for {label}</p>
            <p className="max-w-sm text-sm text-muted">Add the creators you pay for their views. Each month you enter their views and the amount is worked out; payments are recorded as expenses automatically.</p>
            <div className="mt-2">
              <LinkButton href="/partners/new" variant="primary">
                + Add partner
              </LinkButton>
            </div>
          </div>
        ) : (
          <div className="rounded-xl">
            <table className="w-full border-collapse text-sm max-md:table-fixed">
              <thead className="max-md:hidden">
                <tr className="text-left text-xs font-medium text-faint">
                  <th className="px-4 py-2.5 font-medium sm:pl-5">Partner</th>
                  <th className="px-3 py-2.5 text-right font-medium">Views</th>
                  <th className="px-3 py-2.5 text-right font-medium max-xl:hidden">For views</th>
                  <th className="px-3 py-2.5 text-right font-medium">Promotions</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 text-right font-medium max-xl:hidden">Paid</th>
                  <th className="px-3 py-2.5 text-right font-medium">Due</th>
                  <th className="px-3 py-2.5 font-medium max-xl:hidden">Invoice</th>
                  <th className="px-4 py-2.5 sm:pr-5" />
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => {
                  const who = payeeName(r);
                  const status = r.totalPaise > 0 && r.duePaise === 0 ? "paid" : r.duePaise < 0 ? "over" : "due";
                  const invoice = (
                    <InvoiceButton
                      partnerId={r.partnerId}
                      name={who}
                      month={month}
                      monthLabel={label}
                      existing={r.invoiceNo && r.payoutId ? { payoutId: r.payoutId, invoiceNo: r.invoiceNo } : null}
                      defaults={{ date: r.invoiceDate ?? today, period: r.invoicePeriod ?? label, description: r.viewsDescription ?? cfg.payoutViewsDescription, notes: r.invoiceNotes ?? cfg.payoutNotes }}
                      disabled={r.totalPaise <= 0}
                    />
                  );
                  const pay =
                    r.duePaise > 0 ? (
                      <PayPartnerButton partnerId={r.partnerId} name={who} month={month} monthLabel={label} dueLabel={formatMoney(r.duePaise)} suggestPaise={r.duePaise} accounts={accountOpts} defaultAccountId={defaultAccountId} today={payDate} />
                    ) : (
                      <span className={cx("inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold", status === "paid" ? "bg-good-bg text-good" : status === "over" ? "bg-warn-bg text-warn" : "bg-ground text-faint")}>
                        {status === "paid" ? "Paid" : status === "over" ? `${formatMoney(-r.duePaise)} extra` : "—"}
                      </span>
                    );
                  const views = (
                    <ViewsButton
                      partnerId={r.partnerId}
                      name={who}
                      month={month}
                      monthLabel={label}
                      views={r.views}
                      rateUsedPaise={r.rateUsedPaise}
                      viewsAmountPaise={r.viewsAmountPaise}
                      display={r.views > 0 || r.viewsAmountPaise > 0 ? <span className="num">{groupViews(r.views)}</span> : <span className="text-brand-600">+ views</span>}
                    />
                  );
                  const promos = (
                    <PromotionsButton
                      partnerId={r.partnerId}
                      name={who}
                      month={month}
                      monthLabel={label}
                      promotions={r.promotions}
                      display={r.promotionsPaise > 0 ? <Money paise={r.promotionsPaise} /> : <span className="text-brand-600">+ add</span>}
                    />
                  );
                  return (
                    <tr key={r.partnerId} className="border-t border-line/70 align-middle transition-colors hover:bg-brand-50/30">
                      <td className="px-4 py-3 sm:pl-5">
                        <div className="min-w-0">
                          <Link href={`/partners/${r.partnerId}`} className="block truncate font-medium text-ink hover:text-brand-700">
                            {who}
                            {!r.active && <span className="ml-1.5 text-xs font-normal text-faint">(inactive)</span>}
                          </Link>
                          <div className="truncate text-xs text-faint">
                            <span className="num">{r.code}</span>
                            {r.channelName ? ` · ${r.name}` : ""} · {r.kind === "international" ? "International" : "National"}
                          </div>
                          {r.invoiceNo && r.payoutId && (
                            <div className="mt-0.5 flex items-center gap-2 text-xs max-md:hidden xl:hidden">
                              <a href={`/api/partners/payouts/${r.payoutId}/pdf`} target="_blank" rel="noopener" className="font-mono text-brand-600 hover:underline">
                                {r.invoiceNo}
                              </a>
                              <ShareInvoiceButton payoutId={r.payoutId} />
                            </div>
                          )}
                          {/* Phones: the figure that matters, then the three actions. */}
                          <div className="mt-1 text-xs text-muted md:hidden">
                            Total <Money paise={r.totalPaise} className="font-semibold text-ink" />
                            {r.totalPaise > 0 && (
                              <>
                                {" · due "}
                                <Money paise={Math.max(0, r.duePaise)} />
                              </>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:hidden">
                            <span>Views: {views}</span>
                            <span>Promo: {promos}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
                            {invoice}
                            {pay}
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-3 text-right max-md:hidden">{views}</td>
                      <td className="px-3 py-3 text-right max-xl:hidden">
                        <Money paise={r.viewsAmountPaise} blankZero />
                      </td>
                      <td className="px-1 py-3 text-right max-md:hidden">{promos}</td>
                      <td className="px-3 py-3 text-right font-medium max-md:hidden">
                        <Money paise={r.totalPaise} blankZero />
                      </td>
                      <td className="px-3 py-3 text-right text-good max-xl:hidden">
                        <Money paise={r.paidPaise} blankZero />
                      </td>
                      <td className={cx("px-3 py-3 text-right font-semibold max-md:hidden", r.duePaise > 0 ? "text-accent-600" : "text-faint")}>
                        <Money paise={Math.max(0, r.duePaise)} blankZero />
                      </td>
                      <td className="px-3 py-3 max-xl:hidden">
                        {r.invoiceNo && r.payoutId ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <a href={`/api/partners/payouts/${r.payoutId}/pdf`} target="_blank" rel="noopener" className="font-mono text-xs text-brand-600 hover:underline">
                              {r.invoiceNo}
                            </a>
                            <ShareInvoiceButton payoutId={r.payoutId} />
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-md:hidden sm:pr-5">
                        <div className="flex justify-end gap-1.5">
                          {invoice}
                          {pay}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mt-3 text-xs text-faint">
        Click a views or promotions figure to change it. Every payment is saved as a &ldquo;Partner payments&rdquo; expense, so it&apos;s already in your cash, bank and profit &amp; loss. Partners&apos; payments are only visible to people allowed to manage partners.
      </p>

      <details className="mt-6 rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-ink">Payout invoice settings</summary>
        <div className="border-t border-line p-5">
          <PayoutSettingsForm
            initial={{
              payoutPrefix: cfg.payoutPrefix,
              payoutLlpin: cfg.payoutLlpin,
              payoutTan: cfg.payoutTan,
              payoutSignerName: cfg.payoutSignerName,
              payoutSignerRole: cfg.payoutSignerRole,
              payoutShowSignature: cfg.payoutShowSignature,
              payoutRatePerMillionPaise: cfg.payoutRatePerMillionPaise,
              payoutViewsDescription: cfg.payoutViewsDescription,
              payoutNotes: cfg.payoutNotes,
            }}
          />
        </div>
      </details>
    </>
  );
}

function Figure({ dot, label, paise, tone }: { dot: string; label: string; paise: number; tone: string }) {
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
