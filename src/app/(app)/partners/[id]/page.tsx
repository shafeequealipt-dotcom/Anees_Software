import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { PayPartnerButton } from "@/components/partners";
import { Badge, LinkButton, Money, PageHeader, cx } from "@/components/ui";
import { accounts } from "@/db/schema";
import { formatDate, todayIST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { groupViews, paymentToLine } from "@/lib/payout";
import { getPartner, partnerHistory, partnerPayments, partnerSheet, payeeName } from "@/server/partners";
import { requirePartnersUser } from "@/server/partners-page";
import { monthLabel } from "@/server/staff";

export const metadata = { title: "Partner" };

const handleUrl = (kind: "instagram" | "facebook" | "tiktok" | "telegram", v: string) => {
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, "");
  return { instagram: `https://instagram.com/${h}`, facebook: `https://facebook.com/${h}`, tiktok: `https://tiktok.com/@${h}`, telegram: `https://t.me/${h}` }[kind];
};

export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, db } = await requirePartnersUser();
  const p = await getPartner(db, user.firmId, Number((await params).id) || 0);
  if (!p) notFound();
  const today = todayIST();
  const month = today.slice(0, 7);
  const row = (await partnerSheet(db, user.firmId, month)).rows.find((r) => r.partnerId === p.id);
  const [history, payments] = await Promise.all([partnerHistory(db, user.firmId, p.id), partnerPayments(db, user.firmId, p.id)]);
  const accts = await db.select({ id: accounts.id, name: accounts.name, isDefault: accounts.isDefault }).from(accounts).where(and(eq(accounts.firmId, user.firmId), eq(accounts.active, true))).orderBy(asc(accounts.kind), asc(accounts.name));
  const accountOpts = accts.map((a) => ({ id: a.id, name: a.name }));
  const defaultAccountId = (accts.find((a) => a.isDefault) ?? accts[0])?.id ?? null;
  const totalPaid = payments.filter((x) => x.status === "active").reduce((s, x) => s + x.totalPaise, 0);
  const who = payeeName(p);
  const intl = p.kind === "international";
  const links: [string, string, string][] = [];
  if (p.youtubeUrl) links.push(["YouTube", p.youtubeUrl, /^https?:\/\//i.test(p.youtubeUrl) ? p.youtubeUrl : `https://${p.youtubeUrl}`]);
  for (const k of ["instagram", "facebook", "telegram", "tiktok"] as const) if (p[k]) links.push([k[0].toUpperCase() + k.slice(1), p[k]!, handleUrl(k, p[k]!)]);
  const bank = [
    ["Account holder", p.bankHolder],
    ["Bank", p.bankName],
    ["Account number", p.bankAccountNo],
    ["Branch", p.bankBranch],
    ...(intl
      ? [
          ["SWIFT / BIC", p.bankSwift],
          ["IBAN", p.bankIban],
          ["Bank address", p.bankAddress],
        ]
      : [
          ["IFSC", p.bankIfsc],
          ["UPI ID", p.upiId],
        ]),
  ].filter(([, v]) => v) as [string, string][];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {who}
            <Badge tone={intl ? "warn" : "brand"}>{intl ? `International${p.country ? ` · ${p.country}` : ""}` : "National"}</Badge>
            {!p.active && <Badge>Inactive</Badge>}
          </span>
        }
        subtitle={[`ID ${p.code}`, p.channelName ? p.name : null, p.handle, p.phone].filter(Boolean).join(" · ")}
        back={{ href: "/partners", label: "Partners" }}
        actions={
          <>
            <LinkButton href={`/partners/${p.id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            {p.active && row && row.duePaise > 0 && <PayPartnerButton partnerId={p.id} name={who} month={month} monthLabel={monthLabel(month)} dueLabel={formatMoney(row.duePaise)} suggestPaise={row.duePaise} accounts={accountOpts} defaultAccountId={defaultAccountId} today={today} />}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Tile label="Rate per 10,00,000 views" value={<Money paise={p.ratePerMillionPaise} />} />
        <Tile label={`Due for ${monthLabel(month)}`} value={<Money paise={Math.max(0, row?.duePaise ?? 0)} />} tone={row && row.duePaise > 0 ? "text-accent-600" : undefined} />
        <Tile label="Views this month" value={<span className="num">{groupViews(row?.views ?? 0)}</span>} />
        <Tile label="Paid in total" value={<Money paise={totalPaid} />} hint={p.joinedOn ? `since ${formatDate(p.joinedOn)}` : undefined} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink sm:px-5">Contact and channels</div>
          <dl className="grid gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[8rem_1fr] sm:px-5">
            {p.email && <Detail k="Email" v={<a href={`mailto:${p.email}`} className="text-brand-600 hover:underline">{p.email}</a>} />}
            {p.phone && <Detail k="Phone" v={p.phone} />}
            {p.address && <Detail k="Address" v={<span className="whitespace-pre-line">{p.address}</span>} />}
            {p.pan && <Detail k="PAN" v={<span className="font-mono">{p.pan}</span>} />}
            {links.map(([k, v, href]) => (
              <Detail key={k} k={k} v={<a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-brand-600 hover:underline">{v}</a>} />
            ))}
            {!p.email && !p.phone && !p.address && !p.pan && links.length === 0 && <p className="text-muted sm:col-span-2">Nothing added yet.</p>}
          </dl>
        </section>
        <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink sm:px-5">Bank details</div>
          <dl className="grid gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[8rem_1fr] sm:px-5">
            {bank.map(([k, v]) => (
              <Detail key={k} k={k} v={<span className={cx(/number|IBAN|IFSC|SWIFT/i.test(k) && "font-mono")}>{v}</span>} />
            ))}
            {bank.length === 0 && <p className="text-muted sm:col-span-2">No bank details yet. <Link href={`/partners/${p.id}/edit`} className="text-brand-600 hover:underline">Add them.</Link></p>}
          </dl>
          {bank.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-faint sm:px-5">Printed on invoices as: {paymentToLine(p)}</p>}
        </section>
      </div>

      <section className="mb-4 rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink sm:px-5">Month by month</div>
        {history.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No views entered yet. Enter them on the <Link href="/partners" className="text-brand-600 hover:underline">Partners sheet</Link>.</p>
        ) : (
          <div className="overflow-x-auto rounded-b-xl">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-faint">
                  <th className="px-4 py-2.5 font-medium sm:pl-5">Month</th>
                  <th className="px-3 py-2.5 text-right font-medium">Views</th>
                  <th className="px-3 py-2.5 text-right font-medium max-sm:hidden">For views</th>
                  <th className="px-3 py-2.5 text-right font-medium max-sm:hidden">Promotions</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 font-medium max-sm:hidden sm:pr-5">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.payoutId} className="border-t border-line/70">
                    <td className="px-4 py-3 sm:pl-5">
                      <Link href={`/partners?month=${h.month}`} className="font-medium text-ink hover:text-brand-700">
                        {monthLabel(h.month)}
                      </Link>
                    </td>
                    <td className="num px-3 py-3 text-right">{groupViews(h.views)}</td>
                    <td className="px-3 py-3 text-right max-sm:hidden"><Money paise={h.viewsAmountPaise} /></td>
                    <td className="px-3 py-3 text-right max-sm:hidden"><Money paise={h.promotionsPaise} blankZero /></td>
                    <td className="px-3 py-3 text-right font-semibold"><Money paise={h.totalPaise} /></td>
                    <td className="px-4 py-3 max-sm:hidden sm:pr-5">
                      {h.invoiceNo ? (
                        <a href={`/api/partners/payouts/${h.payoutId}/pdf`} target="_blank" rel="noopener" className="font-mono text-xs text-brand-600 hover:underline">
                          {h.invoiceNo}
                        </a>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink sm:px-5">Payments</div>
        {payments.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Nothing paid yet. Payments show up here.</p>
        ) : (
          <ul>
            {payments.map((h) => (
              <li key={h.id} className={cx("flex items-center justify-between gap-3 border-t border-line/70 px-4 py-3 first:border-t-0 sm:px-5", h.status === "cancelled" && "opacity-55")}>
                <div>
                  <Link href={`/expenses/${h.id}`} className="font-medium text-ink hover:text-brand-700">
                    {formatDate(h.date)}
                  </Link>
                  <div className="text-xs text-faint">
                    {h.prefix}
                    {h.number} · for {h.payMonth ? monthLabel(h.payMonth) : "—"}
                    {h.status === "cancelled" && " · cancelled"}
                  </div>
                </div>
                <Money paise={h.totalPaise} className={cx("font-semibold", h.status === "cancelled" && "line-through")} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {p.notes && <p className="mt-3 whitespace-pre-line rounded-xl border border-line bg-panel px-5 py-3 text-sm text-muted">{p.notes}</p>}
    </>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 text-ink">{v}</dd>
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
