import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteMasterButton, PrintButton, WhatsAppButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Badge, LinkButton, Money, PageHeader, Panel, PartyBalance, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { firms, parties, partyGroups } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { stateName } from "@/lib/gst/states";
import { region } from "@/lib/region";
import { formatINR } from "@/lib/money";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { listVouchers, partyStatement } from "@/server/reports";

export const metadata = { title: "Party" };

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  const seeBalance = can(user, "see.partyBalance");
  const seeContact = can(user, "see.partyContact");
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const [p] = await db.select().from(parties).where(eq(parties.id, Number(id) || 0));
  if (!p) notFound();
  const [group] = p.groupId ? await db.select().from(partyGroups).where(eq(partyGroups.id, p.groupId)) : [];
  const [firm] = await db.select().from(firms).where(eq(firms.isDefault, true));
  const settings = await getSettings(db);
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const st = await partyStatement(db, p.id, from, to);
  const [{ balance }] = [{ balance: (await partyStatement(db, p.id, "1900-01-01", "9999-12-31")).closingPaise }];
  const openBills = (await listVouchers(db, { types: ["sale_invoice", "purchase_bill"], partyId: p.id, status: "open" })).slice(0, 20);
  const isCustomer = p.kind !== "supplier";
  const reminder = settings.reminderMessage
    .replace("{party}", p.name)
    .replace("{amount}", formatINR(Math.abs(balance)))
    .replace("{business}", firm?.name ?? "");

  return (
    <>
      <PageHeader
        back={{ href: "/parties", label: "Parties" }}
        title={
          <span className="flex items-center gap-2">
            {p.name} {!p.active && <Badge>Inactive</Badge>}
          </span>
        }
        subtitle={
          seeBalance ? (
            <span>
              Balance: <PartyBalance paise={balance} />
            </span>
          ) : undefined
        }
        actions={
          <>
            {isCustomer && <LinkButton size="sm" href={`/sales/new?party=${p.id}`} variant="primary">New sale</LinkButton>}
            {p.kind !== "customer" && <LinkButton size="sm" href={`/purchases/new?party=${p.id}`}>New purchase</LinkButton>}
            <LinkButton size="sm" href={`/payments-in/new?party=${p.id}`}>Receive payment</LinkButton>
            <LinkButton size="sm" href={`/payments-out/new?party=${p.id}`}>Make payment</LinkButton>
            {seeBalance && seeContact && balance > 0 && p.phone && <WhatsAppButton phone={p.phone} text={reminder} />}
            {can(user, "masters.edit") && <LinkButton size="sm" href={`/parties/${p.id}/edit`}>Edit</LinkButton>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="no-print flex flex-col gap-4">
          <Panel title="Details">
            <dl className="flex flex-col gap-2 text-sm">
              <Detail k="Type" v={p.kind === "both" ? "Customer & supplier" : p.kind === "customer" ? "Customer" : "Supplier"} />
              {seeContact && p.phone && <Detail k="Phone" v={<a className="text-brand-600" href={`tel:${p.phone}`}>{p.phone}</a>} />}
              {seeContact && p.email && <Detail k="Email" v={p.email} />}
              {seeContact && p.gstin && <Detail k={region().taxIdLabel} v={<span className="font-mono">{p.gstin}</span>} />}
              {seeContact && region().usesStates && p.stateCode && <Detail k="State" v={`${p.stateCode} – ${stateName(p.stateCode)}`} />}
              {group && <Detail k="Group" v={group.name} />}
              {p.creditDays != null && <Detail k="Credit period" v={`${p.creditDays} days`} />}
              {seeBalance && p.creditLimitPaise != null && <Detail k="Credit limit" v={<Money paise={p.creditLimitPaise} />} />}
              {seeContact && p.billingAddress && <Detail k="Billing address" v={<span className="whitespace-pre-line">{p.billingAddress}</span>} />}
              {seeContact && p.shippingAddress && <Detail k="Shipping address" v={<span className="whitespace-pre-line">{p.shippingAddress}</span>} />}
              {p.notes && <Detail k="Notes" v={<span className="whitespace-pre-line">{p.notes}</span>} />}
            </dl>
            {can(user, "masters.delete") && (
              <div className="mt-3 border-t border-line pt-2">
                <DeleteMasterButton kind="party" id={p.id} name={p.name} />
              </div>
            )}
          </Panel>
          {seeBalance && openBills.length > 0 && (
            <Panel title="Unpaid bills" padded={false}>
              <ul className="divide-y divide-line text-sm">
                {openBills.map((b) => (
                  <li key={b.id} className="flex justify-between gap-2 px-4 py-2">
                    <Link className="text-brand-600 hover:underline" href={`${VOUCHER_INFO[b.type].path}/${b.id}`}>
                      {b.prefix}
                      {b.number}
                      <span className="ml-1 text-xs text-faint">{formatDate(b.date)}</span>
                    </Link>
                    <Money paise={b.balance_paise} className={b.due_date && b.due_date < todayIST() ? "text-bad" : ""} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        {!seeBalance ? (
          <Panel title="Statement">
            <p className="text-sm text-muted">Your role doesn't include seeing party balances and statements.</p>
          </Panel>
        ) : (
        <Panel
          title={`Statement · ${formatDate(from)} – ${formatDate(to)}`}
          padded={false}
          actions={
            <div className="no-print flex flex-wrap items-center gap-2">
              <DateRange from={from} to={to} />
              <a className="text-sm text-brand-600 hover:underline" href={`/api/export/party-statement?party=${p.id}&from=${from}&to=${to}`}>Excel</a>
              <PrintButton />
            </div>
          }
        >
          <div className="hidden px-4 pt-4 print:block">
            <div className="text-lg font-semibold">{firm?.name}</div>
            <div className="text-sm">Statement of account: {p.name}</div>
          </div>
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Entry</th>
                <th className={th + " text-right"}>Debit (they owe)</th>
                <th className={th + " text-right"}>Credit (paid / we owe)</th>
                <th className={th + " text-right"}>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-ground/40">
                <td className={td}>{formatDate(from)}</td>
                <td className={td + " font-medium"}>Opening balance</td>
                <td className={td} />
                <td className={td} />
                <td className={td + " text-right"}><PartyBalance paise={st.openingPaise} /></td>
              </tr>
              {st.entries.map((e, i) => (
                <tr key={i} className="hover:bg-ground/60">
                  <td className={td + " whitespace-nowrap"}>{formatDate(e.date)}</td>
                  <td className={td}>
                    {e.voucher_id && e.type ? (
                      <Link className="text-brand-600 hover:underline" href={`${VOUCHER_INFO[e.type].path}/${e.voucher_id}`}>
                        {VOUCHER_INFO[e.type].label} {e.prefix}
                        {e.number}
                      </Link>
                    ) : (
                      e.memo ?? "Opening balance"
                    )}
                    {e.voucher_id && e.memo && <div className="text-xs text-faint">{e.memo}</div>}
                  </td>
                  <td className={td + " text-right"}><Money paise={e.debit_paise} blankZero /></td>
                  <td className={td + " text-right"}><Money paise={e.credit_paise} blankZero /></td>
                  <td className={td + " text-right"}><PartyBalance paise={e.balance_paise} /></td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td} />
                <td className={td}>Closing balance</td>
                <td className={td + " text-right"}><Money paise={st.totalDebitPaise} /></td>
                <td className={td + " text-right"}><Money paise={st.totalCreditPaise} /></td>
                <td className={td + " text-right"}><PartyBalance paise={st.closingPaise} /></td>
              </tr>
            </tbody>
          </Table>
        </Panel>
        )}
      </div>
    </>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
