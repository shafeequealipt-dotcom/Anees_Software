import Link from "next/link";
import { DailySalesFilters } from "@/components/daily-sales-filters";
import { PrintButton } from "@/components/party-actions";
import { Badge, Money, PageHeader, cx } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime, isIsoDate, todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { daySalesPurchases, type DayGroup } from "@/server/reports";


type Show = "sales" | "purchases" | "both";
const TITLES: Record<Show, string> = { sales: "Sales for the day", purchases: "Purchases for the day", both: "Sales & purchases for the day" };

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const show = (await searchParams).show;
  return { title: TITLES[show === "sales" || show === "purchases" ? show : "both"] };
}

/**
 * Every sale and purchase of one day (today unless another day is picked), with totals, ready to
 * print. Owners and anyone allowed every shop see all shops (or pick one); someone tied to shops
 * sees only theirs.
 */
export default async function DaySalesPurchasesPage({ searchParams }: { searchParams: Promise<{ date?: string; location?: string; show?: string }> }) {
  const user = await requireUser("reports.sales");
  const sp = await searchParams;
  const today = todayIST();
  // Sales only (from Sale invoices), purchases only (from Purchase bills), or both (from Reports).
  const show: Show = sp.show === "sales" || sp.show === "purchases" ? sp.show : "both";
  const withSales = show !== "purchases";
  const withPurchases = show !== "sales";
  const date = sp.date && isIsoDate(sp.date) && sp.date <= today ? sp.date : today;
  const mine = (id: string) => user.allLocations || user.locations.some((l) => String(l.id) === id);
  let locationId = sp.location && mine(sp.location) ? Number(sp.location) : undefined;
  if (!locationId && !user.allLocations && user.locations.length === 1) locationId = user.locations[0].id;
  const scope = locationId
    ? { locationIds: [locationId], ...(user.allLocations ? {} : { createdBy: user.id }) }
    : user.allLocations
      ? {}
      : { locationIds: user.locations.map((l) => l.id), createdBy: user.id };
  const db = await getDb();
  const r = await daySalesPurchases(db, user.firmId, date, scope, { hideSalaries: !can(user, "staff.manage"), hidePartners: !can(user, "partners.manage") });
  const shopName = locationId ? (user.locations.find((l) => l.id === locationId)?.name ?? "") : user.allLocations ? "All shops" : user.locations.map((l) => l.name).join(", ");
  const showShop = !locationId && (user.allLocations || user.locations.length > 1);
  const nothing = (withSales ? r.sales.bills.length + r.saleReturns.bills.length : 0) + (withPurchases ? r.purchases.bills.length + r.purchaseReturns.bills.length : 0) === 0;
  const what = show === "sales" ? "sales" : show === "purchases" ? "purchases" : "sales or purchases";
  const viewHref = (v: Show) => {
    const q = new URLSearchParams({ ...(v !== "both" ? { show: v } : {}), ...(date !== today ? { date } : {}), ...(sp.location ? { location: sp.location } : {}) }).toString();
    return `/reports/day-sales-purchases${q ? `?${q}` : ""}`;
  };
  const bills = (n: number) => `${n} ${n === 1 ? "bill" : "bills"}`;
  const returnsHint = (n: number) => (n ? `after ${n} return${n === 1 ? "" : "s"}` : "no returns");

  return (
    <>
      <PageHeader
        title={TITLES[show]}
        subtitle={`${shopName} · ${formatDate(date)}${date === today ? " (today)" : ""}`}
        back={{ href: "/reports", label: "Reports" }}
        actions={!nothing && <PrintButton />}
      />
      {/* On paper: who, where and when, since the app's own header isn't printed. */}
      <div className="mb-4 hidden border-b border-ink pb-2 print:block">
        <div className="text-lg font-semibold">{user.firm.name}</div>
        <div className="text-sm">
          {TITLES[show].replace(" for the day", "")} · {shopName} · {formatDate(date)} · printed {formatDateTime(new Date())}
        </div>
      </div>

      <DailySalesFilters date={date} today={today} locationId={locationId ?? null} locations={user.allLocations || user.locations.length > 1 ? user.locations : []} />

      <nav data-no-dirty className="no-print mb-4 inline-flex rounded-lg border border-line bg-panel p-0.5 text-sm" aria-label="Which bills">
        {(["sales", "purchases", "both"] as const).map((v) => (
          <Link key={v} href={viewHref(v)} className={cx("rounded-md px-3 py-1.5 font-medium", show === v ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink")} aria-current={show === v ? "page" : undefined}>
            {v === "sales" ? "Sales" : v === "purchases" ? "Purchases" : "Both"}
          </Link>
        ))}
      </nav>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
        {show === "both" ? (
          <>
            <Tile label="Sales" value={r.sales.totalPaise} hint={bills(r.sales.count)} />
            <Tile label="Net sales" value={r.netSalesPaise} hint={returnsHint(r.saleReturns.count)} strong />
            <Tile label="Purchases" value={r.purchases.totalPaise} hint={bills(r.purchases.count)} />
            <Tile label="Net purchases" value={r.netPurchasesPaise} hint={returnsHint(r.purchaseReturns.count)} strong />
          </>
        ) : show === "sales" ? (
          <>
            <Tile label="Sales" value={r.sales.totalPaise} hint={bills(r.sales.count)} />
            <Tile label="Sale returns" value={r.saleReturns.totalPaise} hint={bills(r.saleReturns.count)} />
            <Tile label="Net sales" value={r.netSalesPaise} hint={returnsHint(r.saleReturns.count)} strong />
            <Tile label="Still to receive" value={r.sales.duePaise} hint="on these bills" />
          </>
        ) : (
          <>
            <Tile label="Purchases" value={r.purchases.totalPaise} hint={bills(r.purchases.count)} />
            <Tile label="Purchase returns" value={r.purchaseReturns.totalPaise} hint={bills(r.purchaseReturns.count)} />
            <Tile label="Net purchases" value={r.netPurchasesPaise} hint={returnsHint(r.purchaseReturns.count)} strong />
            <Tile label="Still to pay" value={r.purchases.duePaise} hint="on these bills" />
          </>
        )}
      </div>

      {nothing ? (
        <div className="rounded-xl border border-line bg-panel px-6 py-12 text-center text-sm text-muted">No {what} on {formatDate(date)}. Use ‹ to look at an earlier day.</div>
      ) : (
        <div className="flex flex-col gap-5">
          {withSales && <BillTable title="Sales" group={r.sales} side="sale" showShop={showShop} />}
          {withSales && r.saleReturns.bills.length > 0 && <BillTable title="Sale returns" group={r.saleReturns} side="sale" showShop={showShop} />}
          {withPurchases && <BillTable title="Purchases" group={r.purchases} side="purchase" showShop={showShop} />}
          {withPurchases && r.purchaseReturns.bills.length > 0 && <BillTable title="Purchase returns" group={r.purchaseReturns} side="purchase" showShop={showShop} />}
        </div>
      )}
      <p className="mt-3 text-xs text-faint print:hidden">Cancelled bills are listed but not counted in the totals. Click a bill number to open it.</p>
    </>
  );
}

function Tile({ label, value, hint, strong }: { label: string; value: number; hint: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 shadow-sm shadow-ink/[0.03] print:shadow-none">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx("num mt-0.5 text-lg text-ink", strong ? "font-semibold" : "font-medium")}>
        <Money paise={value} />
      </div>
      <div className="text-xs text-faint">{hint}</div>
    </div>
  );
}

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted";
const td = "px-3 py-2 align-top";

function BillTable({ title, group, side, showShop }: { title: string; group: DayGroup; side: "sale" | "purchase"; showShop: boolean }) {
  const party = side === "sale" ? "Customer" : "Supplier";
  return (
    <section className="break-inside-avoid-page rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03] print:rounded-none print:border-0 print:shadow-none">
      <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5 print:px-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="text-xs text-muted">
          {group.count} {group.count === 1 ? "bill" : "bills"} · <Money paise={group.totalPaise} className="font-semibold text-ink" />
        </span>
      </div>
      {group.bills.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted print:px-0">None.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Bill no.</th>
                <th className={th}>{party}</th>
                {side === "purchase" && <th className={cx(th, "max-sm:hidden print:table-cell")}>Their bill no.</th>}
                {showShop && <th className={cx(th, "max-sm:hidden print:table-cell")}>Shop</th>}
                <th className={cx(th, "max-sm:hidden print:table-cell")}>Mode</th>
                <th className={cx(th, "text-right")}>Amount</th>
                <th className={cx(th, "text-right max-sm:hidden print:table-cell")}>{side === "sale" ? "Received" : "Paid"}</th>
                <th className={cx(th, "text-right")}>Due</th>
              </tr>
            </thead>
            <tbody>
              {group.bills.map((b) => {
                const off = b.status === "cancelled";
                const due = Math.max(0, b.balance_paise);
                return (
                  <tr key={b.id} className={cx("border-b border-line/70 last:border-0", off && "text-faint")}>
                    <td className={cx(td, "whitespace-nowrap")}>
                      <Link href={`${VOUCHER_INFO[b.type].path}/${b.id}`} className={cx("font-medium hover:underline", off ? "line-through" : "text-brand-600 print:text-ink")}>
                        {b.prefix}
                        {b.number}
                      </Link>
                      {off && (
                        <span className="ml-1.5">
                          <Badge>Cancelled</Badge>
                        </span>
                      )}
                    </td>
                    <td className={td}>{b.party_name || (side === "sale" ? "Cash" : "—")}</td>
                    {side === "purchase" && <td className={cx(td, "max-sm:hidden print:table-cell")}>{b.supplier_invoice_no ?? "—"}</td>}
                    {showShop && <td className={cx(td, "max-sm:hidden print:table-cell")}>{b.location_name ?? "—"}</td>}
                    <td className={cx(td, "max-sm:hidden print:table-cell")}>{b.payment_mode ?? (due > 0 ? "Credit" : "—")}</td>
                    <td className={cx(td, "text-right font-medium", off && "line-through")}>
                      <Money paise={b.total_paise} />
                    </td>
                    <td className={cx(td, "text-right max-sm:hidden print:table-cell")}>{off ? "" : <Money paise={b.total_paise - due} />}</td>
                    <td className={cx(td, "text-right", due > 0 && !off && "font-medium text-accent-600 print:text-ink")}>{off ? "" : <Money paise={due} blankZero />}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className={td} colSpan={2}>
                  Total
                </td>
                {side === "purchase" && <td className={cx(td, "max-sm:hidden print:table-cell")} />}
                {showShop && <td className={cx(td, "max-sm:hidden print:table-cell")} />}
                <td className={cx(td, "max-sm:hidden print:table-cell")} />
                <td className={cx(td, "text-right")}>
                  <Money paise={group.totalPaise} />
                </td>
                <td className={cx(td, "text-right max-sm:hidden print:table-cell")}>
                  <Money paise={group.paidPaise} />
                </td>
                <td className={cx(td, "text-right")}>
                  <Money paise={group.duePaise} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
