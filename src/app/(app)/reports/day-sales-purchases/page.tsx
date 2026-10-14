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

export const metadata = { title: "Sales & purchases for the day" };

/**
 * Every sale and purchase of one day (today unless another day is picked), with totals, ready to
 * print. Owners and anyone allowed every shop see all shops (or pick one); someone tied to shops
 * sees only theirs.
 */
export default async function DaySalesPurchasesPage({ searchParams }: { searchParams: Promise<{ date?: string; location?: string }> }) {
  const user = await requireUser("reports.sales");
  const sp = await searchParams;
  const today = todayIST();
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
  const nothing = r.sales.bills.length + r.saleReturns.bills.length + r.purchases.bills.length + r.purchaseReturns.bills.length === 0;

  return (
    <>
      <PageHeader
        title="Sales & purchases for the day"
        subtitle={`${shopName} · ${formatDate(date)}${date === today ? " (today)" : ""}`}
        back={{ href: "/reports", label: "Reports" }}
        actions={!nothing && <PrintButton />}
      />
      {/* On paper: who, where and when, since the app's own header isn't printed. */}
      <div className="mb-4 hidden border-b border-ink pb-2 print:block">
        <div className="text-lg font-semibold">{user.firm.name}</div>
        <div className="text-sm">
          Sales &amp; purchases · {shopName} · {formatDate(date)} · printed {formatDateTime(new Date())}
        </div>
      </div>

      <DailySalesFilters date={date} today={today} locationId={locationId ?? null} locations={user.allLocations || user.locations.length > 1 ? user.locations : []} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
        <Tile label="Sales" value={r.sales.totalPaise} hint={`${r.sales.count} ${r.sales.count === 1 ? "bill" : "bills"}`} />
        <Tile label="Net sales" value={r.netSalesPaise} hint={r.saleReturns.count ? `after ${r.saleReturns.count} return${r.saleReturns.count === 1 ? "" : "s"}` : "no returns"} strong />
        <Tile label="Purchases" value={r.purchases.totalPaise} hint={`${r.purchases.count} ${r.purchases.count === 1 ? "bill" : "bills"}`} />
        <Tile label="Net purchases" value={r.netPurchasesPaise} hint={r.purchaseReturns.count ? `after ${r.purchaseReturns.count} return${r.purchaseReturns.count === 1 ? "" : "s"}` : "no returns"} strong />
      </div>

      {nothing ? (
        <div className="rounded-xl border border-line bg-panel px-6 py-12 text-center text-sm text-muted">No sales or purchases on {formatDate(date)}. Use ‹ to look at an earlier day.</div>
      ) : (
        <div className="flex flex-col gap-5">
          <BillTable title="Sales" group={r.sales} side="sale" showShop={showShop} />
          {r.saleReturns.bills.length > 0 && <BillTable title="Sale returns" group={r.saleReturns} side="sale" showShop={showShop} />}
          <BillTable title="Purchases" group={r.purchases} side="purchase" showShop={showShop} />
          {r.purchaseReturns.bills.length > 0 && <BillTable title="Purchase returns" group={r.purchaseReturns} side="purchase" showShop={showShop} />}
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
