import Link from "next/link";
import { MonthBars } from "@/components/bar-chart";
import { Alert, LinkButton, Money, PageHeader, Panel, Stat, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { addDays, formatDate, todayIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { can } from "@/lib/permissions";
import { region } from "@/lib/region";
import { dashboard } from "@/server/reports";

export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ welcome?: string; denied?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const d = await dashboard(db);
  const seeMoney = can(user, "money.view");
  const today = todayIST();

  // Fill 12 months so the chart has no gaps
  const months: { month: string; a: number; b: number }[] = [];
  const start = new Date(today.slice(0, 8) + "01T00:00:00Z");
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1));
    const key = dt.toISOString().slice(0, 7);
    const hit = d.salesByMonth.find((m) => m.month === key);
    months.push({ month: key, a: hit?.sales ?? 0, b: hit?.purchases ?? 0 });
  }
  const cashTotal = d.money.reduce((s, m) => s + m.balance, 0);

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${user.name.split(" ")[0]}`}
        subtitle={formatDate(today)}
        actions={
          <>
            <LinkButton href="/payments-in/new" size="sm">Receive payment</LinkButton>
            <LinkButton href="/expenses/new" size="sm">Add expense</LinkButton>
            <LinkButton href="/sales/new" variant="primary" size="sm">New sale invoice</LinkButton>
          </>
        }
      />
      {sp.welcome && (
        <div className="mb-4">
          <Alert tone="good">
            Your business is set up. Next: add your <Link className="underline" href="/items/new">items</Link>, your{" "}
            <Link className="underline" href="/parties/new">customers and suppliers</Link>, and your{" "}
            <Link className="underline" href="/cash-bank">bank accounts</Link>. Then create your first sale invoice.
          </Alert>
        </div>
      )}
      {sp.denied && (
        <div className="mb-4">
          <Alert tone="warn">Your role doesn&apos;t have access to that page. Ask the owner if you need it.</Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {can(user, "see.partyBalance") && (
          <>
            <Stat label="To receive from customers" value={formatINR(d.receivable)} tone="good" href="/parties?show=receivable" />
            <Stat label="To pay suppliers" value={formatINR(d.payable)} tone="bad" href="/parties?show=payable" />
          </>
        )}
        {seeMoney ? (
          <Stat label="Cash & bank balance" value={formatINR(cashTotal)} href="/cash-bank" hint={`${d.money.length} account${d.money.length === 1 ? "" : "s"}`} />
        ) : (
          <Stat label="Invoices this month" value={d.month.invoices} href="/sales" />
        )}
        <Stat label="Low stock items" value={d.lowStock} tone={d.lowStock ? "warn" : undefined} href="/items?show=low" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Sales and purchases, last 12 months" className="lg:col-span-2" actions={<Legend />}>
          <MonthBars data={months} />
          <p className="mt-1 text-xs text-faint">Amounts before tax, net of returns.</p>
        </Panel>
        <Panel title="This month">
          <dl className="flex flex-col gap-2.5 text-sm">
            <Row label="Sales" value={<Money paise={d.month.sales} />} href="/sales" />
            <Row label="Purchases" value={<Money paise={d.month.purchases} />} href="/purchases" />
            <Row label="Expenses" value={<Money paise={d.month.expenses} />} href="/expenses" />
            <Row label="Payments received" value={<Money paise={d.month.received} className="text-good" />} href="/payments-in" />
            <Row label="Payments made" value={<Money paise={d.month.paid} className="text-bad" />} href="/payments-out" />
          </dl>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Overdue invoices" padded={false} actions={<Link href="/sales?status=overdue" className="text-xs text-brand-600">See all</Link>}>
          {d.overdue.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No overdue invoices.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Party</th>
                  <th className={th}>Due</th>
                  <th className={th + " text-right"}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {d.overdue.map((o) => (
                  <tr key={o.id} className="hover:bg-ground/60">
                    <td className={td}><Link className="text-brand-600 hover:underline" href={`/sales/${o.id}`}>{o.prefix}{o.number}</Link></td>
                    <td className={td}>{o.party_name}</td>
                    <td className={td + " text-bad"}>{formatDate(o.due_date)} · {Math.max(1, Math.round((Date.parse(today) - Date.parse(o.due_date)) / 86400000))}d</td>
                    <td className={td + " text-right"}><Money paise={o.balance_paise} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        {seeMoney && (
          <Panel title="Cash & bank" padded={false} actions={<Link href="/cash-bank" className="text-xs text-brand-600">Open</Link>}>
            <Table>
              <tbody>
                {d.money.map((m) => (
                  <tr key={m.id} className="hover:bg-ground/60">
                    <td className={td}><Link className="hover:underline" href={`/cash-bank/${m.id}?from=${addDays(today, -30)}`}>{m.name}</Link></td>
                    <td className={td + " text-muted"}>{m.kind === "cash" ? "Cash" : "Bank"}</td>
                    <td className={td + " text-right"}><Money paise={m.balance} className={m.balance < 0 ? "text-bad" : ""} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}
      </div>
    </>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: region().timezone }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function Row({ label, value, href }: { label: string; value: React.ReactNode; href: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
      <dt><Link href={href} className="text-muted hover:text-brand-600">{label}</Link></dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-brand-500" /> Sales</span>
      <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-brand-200" /> Purchases</span>
    </div>
  );
}
