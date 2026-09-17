import Link from "next/link";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/filters";
import { Badge, Empty, LinkButton, Money, PageHeader, Panel, StatusBadge, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { resolvePeriod } from "@/lib/periods";
import { typeFromPath, VOUCHER_INFO } from "@/lib/voucher-types";
import { listVouchers } from "@/server/reports";

type SP = { from?: string; to?: string; q?: string; status?: string; saved?: string };

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const type = typeFromPath((await params).section);
  return { title: type ? VOUCHER_INFO[type].plural : "Not found" };
}

export default async function VoucherListPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<SP> }) {
  const { section } = await params;
  const type = typeFromPath(section);
  if (!type) notFound();
  const info = VOUCHER_INFO[type];
  const user = await requireUser(["money_adjustment", "money_transfer", "other_income"].includes(type) ? "money.view" : undefined);
  const sp = await searchParams;
  const { presets, from, to } = resolvePeriod(sp, info.takesPayment ? "month" : "fy");
  const status = (sp.status ?? "all") as "open" | "paid" | "overdue" | "cancelled" | "all";
  const db = await getDb();
  const list = await listVouchers(db, { types: [type], from, to, q: sp.q, status });
  const active = list.filter((r) => r.status === "active");
  const sum = (f: (r: (typeof list)[number]) => number) => active.reduce((s, r) => s + f(r), 0);
  const today = todayIST();
  const showBalance = info.takesPayment;
  const showConverted = info.convertsTo.length > 0 && !info.posts;
  const exportHref = `/api/export/vouchers?type=${type}&from=${from}&to=${to}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}${sp.status ? `&status=${sp.status}` : ""}`;

  return (
    <>
      <PageHeader
        title={info.plural}
        actions={
          <>
            {can(user.role, "reports.sales") && (
              <a href={exportHref} className="text-sm text-brand-600 hover:underline">
                Export to Excel
              </a>
            )}
            <LinkButton href={`${info.path}/new`} variant="primary">
              + New {info.label.toLowerCase()}
            </LinkButton>
          </>
        }
      />
      {sp.saved && <p className="mb-3 rounded-md bg-good-bg px-3 py-2 text-sm text-good">Saved {sp.saved}.</p>}
      <ListFilters
        presets={presets}
        from={from}
        to={to}
        q={sp.q}
        status={sp.status}
        searchPlaceholder="Search party, number, note…"
        statusOptions={
          showBalance
            ? [
                { value: "all", label: "All" },
                { value: "open", label: "Unpaid" },
                { value: "overdue", label: "Overdue" },
                { value: "paid", label: "Paid" },
                { value: "cancelled", label: "Cancelled" },
              ]
            : [
                { value: "all", label: "All" },
                { value: "cancelled", label: "Cancelled" },
              ]
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Count" value={active.length.toString()} />
        <Tile label="Total" value={<Money paise={sum((r) => r.total_paise)} />} />
        {info.hasLines && type !== "stock_adjustment" && <Tile label="Tax" value={<Money paise={sum((r) => r.tax_paise)} />} />}
        {showBalance && <Tile label="Unpaid" value={<Money paise={sum((r) => Math.max(0, r.balance_paise))} className="text-bad" />} />}
      </div>

      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title={`No ${info.plural.toLowerCase()} in this period`} action={<LinkButton href={`${info.path}/new`} variant="primary">+ New {info.label.toLowerCase()}</LinkButton>}>
            Change the dates above, or create a new one.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Number</th>
                {info.partySide !== "none" && <th className={th}>Party</th>}
                {(type === "expense" || type === "other_income") && <th className={th}>Category</th>}
                {!info.hasLines && <th className={th}>Account</th>}
                <th className={th + " text-right"}>Total</th>
                {showBalance && <th className={th + " text-right"}>Unpaid</th>}
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const st =
                  r.status === "cancelled"
                    ? "cancelled"
                    : showBalance && r.party_id
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
                return (
                  <tr key={r.id} className={"hover:bg-ground/60 " + (r.status === "cancelled" ? "text-faint line-through" : "")}>
                    <td className={td + " whitespace-nowrap"}>{formatDate(r.date)}</td>
                    <td className={td}>
                      <Link href={`${info.path}/${r.id}`} className="font-medium text-brand-600 hover:underline">
                        {r.prefix}
                        {r.number}
                      </Link>
                      {r.supplier_invoice_no && <div className="text-xs text-faint">Supplier bill {r.supplier_invoice_no}</div>}
                    </td>
                    {info.partySide !== "none" && (
                      <td className={td}>
                        {r.party_id ? (
                          <Link href={`/parties/${r.party_id}`} className="hover:underline">
                            {r.party_name}
                          </Link>
                        ) : (
                          <span className="text-muted">{r.party_name || "Cash"}</span>
                        )}
                      </td>
                    )}
                    {(type === "expense" || type === "other_income") && <td className={td}>{r.category_name ?? "—"}</td>}
                    {!info.hasLines && <td className={td}>{r.account_name}{r.payment_mode && <span className="text-xs text-faint"> · {r.payment_mode}</span>}</td>}
                    <td className={td + " text-right"}>
                      <Money paise={r.total_paise} />
                    </td>
                    {showBalance && (
                      <td className={td + " text-right"}>
                        <Money paise={Math.max(0, r.balance_paise)} blankZero />
                      </td>
                    )}
                    <td className={td}>{st ? <StatusBadge status={st} /> : r.status === "active" ? <Badge tone="good">Saved</Badge> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      {list.length >= 1000 && <p className="mt-2 text-xs text-muted">Showing the latest 1,000. Narrow the dates to see older entries.</p>}
      <p className="mt-2 text-xs text-faint">
        {formatDate(from)} – {formatDate(to)}
      </p>
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
