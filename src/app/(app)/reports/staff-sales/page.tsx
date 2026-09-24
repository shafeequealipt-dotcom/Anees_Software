import { PrintButton } from "@/components/party-actions";
import { DateRange, LinkSelect } from "@/components/simple-filters";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { staffSales } from "@/server/reports";

export const metadata = { title: "Staff sales" };

export default async function StaffSalesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; location?: string }> }) {
  const user = await requireUser("reports.all");
  const sp = await searchParams;
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const locationId = sp.location && (user.allLocations || user.locations.some((l) => String(l.id) === sp.location)) ? Number(sp.location) : undefined;
  const db = await getDb();
  const list = await staffSales(db, user.firmId, from, to, locationId);
  const totalBills = list.reduce((s, r) => s + r.bills, 0);
  const totalSales = list.reduce((s, r) => s + r.salesPaise, 0);
  const totalReturns = list.reduce((s, r) => s + r.returnsPaise, 0);

  return (
    <>
      <PageHeader title="Staff sales" subtitle="Who sold what, per shop and date range." back={{ href: "/reports", label: "Reports" }} actions={<PrintButton />} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <DateRange from={from} to={to} />
        {user.locations.length > 1 && (
          <LinkSelect
            param="location"
            ariaLabel="Shop"
            current={locationId ? String(locationId) : ""}
            options={[{ value: "", label: "All shops" }, ...user.locations.map((l) => ({ value: String(l.id), label: l.name }))]}
          />
        )}
      </div>
      <Panel padded={false} title={`${formatDate(from)} – ${formatDate(to)}`}>
        {list.length === 0 ? (
          <Empty title="No sales in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Staff</th>
                <th className={th + " text-right"}>Bills</th>
                <th className={th + " text-right"}>Sales</th>
                <th className={th + " text-right"}>Returns</th>
                <th className={th + " text-right"}>Net</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i} className="hover:bg-ground/60">
                  <td className={td}>{r.name}</td>
                  <td className={td + " text-right"}>{r.bills}</td>
                  <td className={td + " text-right"}>
                    <Money paise={r.salesPaise} />
                  </td>
                  <td className={td + " text-right"}>{r.returnsPaise > 0 ? <Money paise={r.returnsPaise} /> : "—"}</td>
                  <td className={td + " text-right font-medium"}>
                    <Money paise={r.netPaise} />
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total</td>
                <td className={td + " text-right"}>{totalBills}</td>
                <td className={td + " text-right"}>
                  <Money paise={totalSales} />
                </td>
                <td className={td + " text-right"}>{totalReturns > 0 ? <Money paise={totalReturns} /> : "—"}</td>
                <td className={td + " text-right"}>
                  <Money paise={totalSales - totalReturns} />
                </td>
              </tr>
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
