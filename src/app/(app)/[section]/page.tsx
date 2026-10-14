import Link from "next/link";
import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { HoverMenu } from "@/components/hover-menu";
import { ListToolbar, type ToolbarTab } from "@/components/list-toolbar";
import { Badge, LinkButton, Money, PageHeader, StatusBadge, cx } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { resolvePeriod } from "@/lib/periods";
import { typeFromPath, VOUCHER_INFO } from "@/lib/voucher-types";
import { listLocations } from "@/server/locations";
import { listVouchers } from "@/server/reports";

type SP = { from?: string; to?: string; q?: string; status?: string; saved?: string; view?: string };

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const type = typeFromPath((await params).section);
  return { title: type ? VOUCHER_INFO[type].plural : "Not found" };
}

/** A soft, stable colour per party so the same customer always looks the same. */
const AVATAR = ["bg-brand-100 text-brand-700", "bg-accent-100 text-accent-600", "bg-good-bg text-good", "bg-sky-100 text-sky-700", "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700"];
const avatarClass = (name: string) => AVATAR[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR.length];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export default async function VoucherListPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<SP> }) {
  const { section } = await params;
  const type = typeFromPath(section);
  if (!type) notFound();
  const info = VOUCHER_INFO[type];
  const user = await requireUser(["money_adjustment", "money_transfer", "other_income"].includes(type) ? "money.view" : undefined);
  const sp = await searchParams;
  // Sales and purchase bills open on today's bills (one day at a time, ‹ › to step back); the unpaid and
  // overdue views, reached from reports and the home page, keep the whole year so nothing owed is missed.
  const daily = type === "sale_invoice" || type === "purchase_bill";
  const wideStatus = sp.status === "open" || sp.status === "overdue";
  const { presets, from, to } = resolvePeriod(sp, daily ? (wideStatus ? "fy" : "today") : info.takesPayment ? "month" : "fy");
  const db = await getDb();
  // Every status at once, so each tab can show its count; the chosen tab is filtered here.
  const list = await listVouchers(db, user.firmId, {
    types: [type],
    from,
    to,
    q: sp.q,
    status: "all",
    hideSalaries: !can(user, "staff.manage"),
    hidePartners: !can(user, "partners.manage"),
    ...(user.allLocations ? {} : { locationIds: user.locations.map((l) => l.id), createdBy: user.id }),
  });

  const today = todayIST();
  const isTransfer = type === "stock_transfer";
  const showBalance = info.takesPayment;
  const showConverted = info.convertsTo.length > 0 && !info.posts;
  const myLocationIds = new Set(user.locations.map((l) => l.id));
  type Row = (typeof list)[number];
  const active = (r: Row) => r.status === "active";

  const filters: { key: string; label: string; test: (r: Row) => boolean; alert?: boolean }[] = [{ key: "all", label: "All", test: () => true }];
  if (isTransfer) {
    filters.push(
      { key: "incoming", label: "Incoming", test: (r) => active(r) && !r.received_at && (user.allLocations || (r.to_location_id != null && myLocationIds.has(r.to_location_id))), alert: true },
      { key: "outgoing", label: "Outgoing", test: (r) => user.allLocations || (r.location_id != null && myLocationIds.has(r.location_id)) },
    );
  } else if (showBalance) {
    filters.push(
      { key: "open", label: "Unpaid", test: (r) => active(r) && r.balance_paise > 0 },
      { key: "overdue", label: "Overdue", test: (r) => active(r) && r.balance_paise > 0 && !!r.due_date && r.due_date < today, alert: true },
      { key: "paid", label: "Paid", test: (r) => active(r) && r.balance_paise <= 0 },
    );
  } else if (showConverted) {
    filters.push({ key: "pending", label: "Open", test: (r) => active(r) && !r.converted }, { key: "converted", label: "Converted", test: (r) => active(r) && r.converted });
  }
  filters.push({ key: "cancelled", label: "Cancelled", test: (r) => r.status === "cancelled" });

  // Stock transfers have always used ?view= (the dashboard links to ?view=incoming); everything else uses ?status=.
  const param = isTransfer ? "view" : "status";
  const chosen = filters.find((f) => f.key === (isTransfer ? sp.view : sp.status)) ?? filters[0];
  const visible = list.filter(chosen.test);
  const tabHref = (key: string) => {
    const p = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => e[1] != null && e[0] !== "saved"));
    p.delete("status");
    p.delete("view");
    if (key !== "all") p.set(param, key);
    const s = p.toString();
    return s ? `${info.path}?${s}` : info.path;
  };
  const tabs: ToolbarTab[] = filters.map((f) => ({ key: f.key, label: f.label, count: list.filter(f.test).length, href: tabHref(f.key), active: f.key === chosen.key, alert: f.alert }));

  const counted = visible.filter(active);
  const sum = (f: (r: Row) => number) => counted.reduce((s, r) => s + f(r), 0);
  const total = sum((r) => r.total_paise);
  const unpaid = sum((r) => Math.max(0, r.balance_paise));
  const received = Math.max(0, total - unpaid);
  // Settled money is "received" when it comes to us, "paid" when it goes out (purchases, expenses, refunds to customers).
  const settledLabel = type === "sale_invoice" || type === "debit_note" || type === "other_income" ? "Received" : "Paid";
  const showTax = info.hasLines && type !== "stock_adjustment" && type !== "stock_transfer";
  const exportStatus = ["open", "overdue", "paid", "cancelled"].includes(chosen.key) ? `&status=${chosen.key}` : "";
  const exportHref = `/api/export/vouchers?type=${type}&from=${from}&to=${to}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${exportStatus}`;
  const warehouseId = isTransfer ? (await listLocations(db, user.firmId)).find((l) => l.kind === "warehouse")?.id : undefined;
  const noun = (n: number) => `${n} ${n === 1 ? info.label.toLowerCase() : info.plural.toLowerCase()}`;

  const more = [
    can(user, "reports.sales") && { href: exportHref, label: "Export to Excel", download: true },
    (type === "sale_invoice" || type === "purchase_bill") && can(user, "vouchers.create") && { href: `${info.path}/combine`, label: type === "sale_invoice" ? "Combine orders & challans" : "Combine orders" },
    isTransfer && warehouseId && can(user, "vouchers.create") && { href: `${info.path}/new?to=${warehouseId}`, label: "Return to warehouse" },
  ].filter(Boolean) as { href: string; label: string; download?: boolean }[];

  return (
    <>
      <PageHeader
        title={info.plural}
        subtitle={from === to ? `${formatDate(from)}${from === today ? " (today)" : ""}` : `${formatDate(from)} – ${formatDate(to)}`}
        actions={
          <>
            {more.length > 0 && (
              <HoverMenu
                panelClassName="pt-1.5"
                trigger={
                  <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-ink hover:border-brand-200">
                    More
                    <svg viewBox="0 0 20 20" className="size-3.5 text-faint" aria-hidden="true">
                      <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                }
              >
                <div className="w-60 rounded-xl border border-line bg-panel p-1.5 shadow-lg shadow-ink/10">
                  {more.map((m) =>
                    m.download ? (
                      <a key={m.href} href={m.href} className="block rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-ground">
                        {m.label}
                      </a>
                    ) : (
                      <Link key={m.href} href={m.href} className="block rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-ground">
                        {m.label}
                      </Link>
                    ),
                  )}
                </div>
              </HoverMenu>
            )}
            <LinkButton href={`${info.path}/new`} variant="primary">
              + New {info.label.toLowerCase()}
            </LinkButton>
          </>
        }
      />
      {sp.saved && <p className="mb-4 rounded-lg border-l-4 border-good bg-good-bg px-3 py-2 text-sm text-good">Saved {sp.saved}.</p>}

      {daily && from === to && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <DayNav date={from} today={today} mode="range" />
          <Link href={`/reports/day-sales-purchases?show=${type === "sale_invoice" ? "sales" : "purchases"}${from === today ? "" : `&date=${from}`}`} className="no-print text-sm font-medium text-brand-600 hover:underline">
            {type === "sale_invoice" ? "Print the day's sales" : "Print the day's purchases"}
          </Link>
        </div>
      )}
      <section className="mb-4 rounded-xl border border-line bg-panel px-4 py-4 shadow-sm shadow-ink/[0.03] sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <div className="text-xs font-medium text-muted">{chosen.key === "all" ? "Total" : `Total · ${chosen.label.toLowerCase()}`}</div>
            <div className="num mt-0.5 text-2xl font-semibold tracking-tight text-ink">
              <Money paise={total} />
            </div>
            <div className="mt-0.5 text-xs text-faint">
              {noun(counted.length)}
              {showTax && sum((r) => r.tax_paise) > 0 && (
                <>
                  {" · tax "}
                  <Money paise={sum((r) => r.tax_paise)} />
                </>
              )}
            </div>
          </div>
          {showBalance && total > 0 && (
            <div className="flex gap-6 sm:gap-8">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  <span className="size-2 rounded-full bg-good" />
                  {settledLabel}
                </div>
                <div className="num mt-0.5 text-base font-semibold text-good sm:text-lg">
                  <Money paise={received} />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  <span className="size-2 rounded-full bg-accent-500" />
                  Unpaid
                </div>
                <div className={cx("num mt-0.5 text-base font-semibold sm:text-lg", unpaid > 0 ? "text-accent-600" : "text-faint")}>
                  <Money paise={unpaid} />
                </div>
              </div>
            </div>
          )}
        </div>
        {showBalance && total > 0 && (
          <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-accent-100" title={`${Math.round((received / total) * 100)}% ${settledLabel.toLowerCase()}`}>
            <div className="h-full rounded-full bg-good transition-all" style={{ width: `${(received / total) * 100}%` }} />
          </div>
        )}
      </section>

      {/* No overflow-hidden here: it would clip the period menu that opens out of the toolbar. */}
      <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
        <ListToolbar tabs={tabs} presets={presets} from={from} to={to} q={sp.q} searchPlaceholder={info.partySide !== "none" ? "Search party, number, note…" : "Search number, note…"} />
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-6" aria-hidden="true">
                <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5Z" strokeLinejoin="round" />
                <path d="M14 3.5V8h4M10 12.5h5M10 16h3" strokeLinecap="round" />
              </svg>
            </div>
            <p className="font-medium text-ink">{sp.q ? `Nothing matches “${sp.q}”` : chosen.key === "all" ? `No ${info.plural.toLowerCase()} in this period` : `No ${chosen.label.toLowerCase()} ${info.plural.toLowerCase()} here`}</p>
            <p className="max-w-sm text-sm text-muted">{sp.q ? "Try a different word, or clear the search." : "Try another period, or create a new one."}</p>
            {!sp.q && chosen.key === "all" && (
              <div className="mt-2">
                <LinkButton href={`${info.path}/new`} variant="primary">
                  + New {info.label.toLowerCase()}
                </LinkButton>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-b-xl">
            {/* On a phone only the first column shows, so a fixed layout lets long party names truncate instead of pushing the amount off-screen. */}
            <table className="w-full border-collapse text-sm max-sm:table-fixed">
              <thead className="max-sm:hidden">
                <tr className="text-left text-xs font-medium text-faint">
                  <th className="px-4 py-2.5 font-medium sm:pl-5">{info.partySide !== "none" ? "Party" : "Entry"}</th>
                  {isTransfer && <th className="px-4 py-2.5 font-medium max-sm:hidden">From → To</th>}
                  {(type === "expense" || type === "other_income") && <th className="px-4 py-2.5 font-medium max-sm:hidden">Category</th>}
                  {!info.hasLines && <th className="px-4 py-2.5 font-medium max-sm:hidden">Account</th>}
                  <th className="px-4 py-2.5 text-right font-medium max-sm:hidden">Amount</th>
                  {showBalance && <th className="px-4 py-2.5 text-right font-medium max-sm:hidden">Unpaid</th>}
                  <th className="px-4 py-2.5 font-medium max-sm:hidden sm:pr-5">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const cancelled = r.status === "cancelled";
                  const st =
                    cancelled
                      ? "cancelled"
                      : showBalance
                        ? r.balance_paise <= 0
                          ? "paid"
                          : r.due_date && r.due_date < today
                            ? "overdue"
                            : r.balance_paise < r.total_paise
                              ? "partial"
                              : "unpaid"
                        : showConverted
                          ? r.converted
                            ? "converted"
                            : "open"
                          : null;
                  const name = info.partySide !== "none" ? r.party_name || "Cash" : `${r.prefix}${r.number}`;
                  const href = `${info.path}/${r.id}`;
                  const badge = cancelled ? (
                    <StatusBadge status="cancelled" />
                  ) : isTransfer ? (
                    <Badge tone={r.received_at ? "good" : "warn"}>{r.received_at ? "Received" : "In transit"}</Badge>
                  ) : st ? (
                    <StatusBadge status={st} />
                  ) : r.status === "active" ? (
                    <Badge tone="good">Saved</Badge>
                  ) : null;
                  return (
                    <tr key={r.id} className={cx("group relative border-t border-line/70 transition-colors hover:bg-brand-50/40", cancelled && "opacity-55")}>
                      <td className="px-4 py-3 sm:pl-5">
                        <div className="flex items-center gap-2.5 sm:gap-3">
                          <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:size-9", info.partySide !== "none" && r.party_id ? avatarClass(name) : "bg-ground text-muted")}>
                            {info.partySide !== "none" ? initials(name) : "#"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Link href={href} className={cx("block truncate font-medium text-ink after:absolute after:inset-0 group-hover:text-brand-700", cancelled && "line-through")}>
                              {name}
                            </Link>
                            <div className="truncate text-xs text-faint">
                              {info.partySide !== "none" && (
                                <>
                                  <span className="font-medium text-muted">
                                    {r.prefix}
                                    {r.number}
                                  </span>
                                  {" · "}
                                </>
                              )}
                              {formatDate(r.date)}
                              {r.supplier_invoice_no && ` · bill ${r.supplier_invoice_no}`}
                            </div>
                          </div>
                          <div className="ml-auto flex shrink-0 flex-col items-end gap-1 sm:hidden">
                            <Money paise={r.total_paise} className="font-semibold text-ink" />
                            {badge}
                          </div>
                        </div>
                      </td>
                      {isTransfer && (
                        <td className="px-4 py-3 text-muted max-sm:hidden">
                          {r.location_name ?? "—"} <span className="text-faint">→</span> {r.to_location_name ?? "—"}
                        </td>
                      )}
                      {(type === "expense" || type === "other_income") && <td className="px-4 py-3 text-muted max-sm:hidden">{r.category_name ?? "—"}</td>}
                      {!info.hasLines && (
                        <td className="px-4 py-3 text-muted max-sm:hidden">
                          {r.account_name}
                          {r.payment_mode && <span className="text-xs text-faint"> · {r.payment_mode}</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-semibold text-ink max-sm:hidden">
                        <Money paise={r.total_paise} />
                      </td>
                      {showBalance && (
                        <td className="px-4 py-3 text-right text-accent-600 max-sm:hidden">
                          <Money paise={Math.max(0, r.balance_paise)} blankZero />
                        </td>
                      )}
                      <td className="px-4 py-3 max-sm:hidden sm:pr-5">{badge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {list.length >= 1000 && <p className="mt-2 text-xs text-muted">Showing the latest 1,000. Pick a shorter period to see older entries.</p>}
    </>
  );
}
