import { DailySalesFilters } from "@/components/daily-sales-filters";
import { ShareFileButton } from "@/components/share-file-button";
import { Empty, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { dailySalesReport } from "@/server/reports";
import { ProductName } from "@/components/product-name";

export const metadata = { title: "Daily sales" };

export default async function DailySalesPage({ searchParams }: { searchParams: Promise<{ date?: string; location?: string }> }) {
  const user = await requireUser("reports.all");
  const sp = await searchParams;
  const date = sp.date ?? todayIST();
  let locationId = sp.location && (user.allLocations || user.locations.some((l) => String(l.id) === sp.location)) ? Number(sp.location) : undefined;
  if (!locationId && !user.allLocations && user.locations.length === 1) locationId = user.locations[0].id;
  const db = await getDb();
  const r = await dailySalesReport(db, user.firmId, date, locationId);

  const qs = new URLSearchParams({ date, ...(locationId ? { location: String(locationId) } : {}) });
  const pdfBase = `/api/reports/daily-sales/pdf?${qs}`;
  const shareText = `${user.firm.name}: Daily sales${r.locationName ? ` — ${r.locationName}` : ""}, ${formatDate(date)}. Net sales ${r.netSalesPaise / 100} (${r.bills} bills).`;

  return (
    <>
      <PageHeader
        title="Daily sales"
        subtitle={r.locationName ? `${r.locationName} · ${formatDate(date)}` : `All shops · ${formatDate(date)}`}
        back={{ href: "/reports", label: "Reports" }}
        actions={
          <>
            <a className="inline-flex h-8 items-center rounded-md border border-line bg-panel px-2.5 text-sm font-medium hover:bg-ground" href={`${pdfBase}&paper=a4`} target="_blank" rel="noopener">
              Print A4
            </a>
            <a className="inline-flex h-8 items-center rounded-md border border-line bg-panel px-2.5 text-sm font-medium hover:bg-ground" href={`${pdfBase}&paper=t80`} target="_blank" rel="noopener" title="Short slip for the receipt printer">
              Print slip
            </a>
            <a className="inline-flex h-8 items-center rounded-md border border-line bg-panel px-2.5 text-sm font-medium hover:bg-ground" href={`${pdfBase}&paper=a4&download=1`}>
              Download
            </a>
            <ShareFileButton url={`${pdfBase}&paper=a4&download=1`} filename={`daily-sales-${date}.pdf`} title="Daily sales report" text={shareText} />
          </>
        }
      />
      <DailySalesFilters date={date} today={todayIST()} locationId={locationId ?? null} locations={user.locations} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Bills" value={String(r.bills)} />
        <Tile label="Gross sales" value={<Money paise={r.grossSalesPaise} />} />
        <Tile label="Returns" value={<Money paise={r.returnsPaise} className={r.returnsPaise > 0 ? "text-bad" : undefined} />} />
        <Tile label="Net sales" value={<Money paise={r.netSalesPaise} className="font-semibold" />} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Paid on bill" value={<Money paise={r.paidOnBillPaise} />} />
        <Tile label="Payments received" value={<Money paise={r.paymentsReceivedPaise} />} />
        <Tile label="Unpaid (credit sales)" value={<Money paise={r.unpaidPaise} className={r.unpaidPaise > 0 ? "text-warn" : undefined} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By payment mode" padded={false}>
          {r.byPaymentMode.length === 0 ? (
            <Empty title="No payments recorded" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Mode</th>
                  <th className={th + " text-right"}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.byPaymentMode.map((m) => (
                  <tr key={m.mode}>
                    <td className={td}>{m.mode}</td>
                    <td className={td + " text-right"}>
                      <Money paise={m.amountPaise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Top items" padded={false}>
          {r.topItems.length === 0 ? (
            <Empty title="No sales on this day" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Item</th>
                  <th className={th + " text-right"}>Qty</th>
                  <th className={th + " text-right"}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.topItems.map((i, idx) => (
                  <tr key={idx}>
                    <td className={td}><ProductName code={i.code} name={i.name} /></td>
                    <td className={td + " text-right"}>
                      {formatQty(i.qtyMilli)} {i.unitCode}
                    </td>
                    <td className={td + " text-right"}>
                      <Money paise={i.amountPaise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      {r.byStaff.length > 0 && (
        <Panel title="By staff" padded={false} className="mt-4">
          <Table>
            <thead>
              <tr>
                <th className={th}>Staff</th>
                <th className={th + " text-right"}>Bills</th>
                <th className={th + " text-right"}>Sales</th>
                <th className={th + " text-right"}>Returns</th>
              </tr>
            </thead>
            <tbody>
              {r.byStaff.map((s, idx) => (
                <tr key={idx}>
                  <td className={td}>{s.name}</td>
                  <td className={td + " text-right"}>{s.bills}</td>
                  <td className={td + " text-right"}>
                    <Money paise={s.salesPaise} />
                  </td>
                  <td className={td + " text-right"}>{s.returnsPaise > 0 ? <Money paise={s.returnsPaise} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 font-semibold">{value}</div>
    </div>
  );
}
