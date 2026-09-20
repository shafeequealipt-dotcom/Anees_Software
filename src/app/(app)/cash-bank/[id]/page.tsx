import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/party-actions";
import { DateRange } from "@/components/simple-filters";
import { Badge, LinkButton, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { accounts, firms } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { financialYear, formatDate, todayIST } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { accountStatement } from "@/server/reports";

export const metadata = { title: "Account statement" };

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser("money.view");
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const [a] = await db.select().from(accounts).where(eq(accounts.id, Number(id) || 0));
  if (!a) notFound();
  const [firm] = await db.select().from(firms).where(eq(firms.isDefault, true));
  const fy = financialYear(todayIST());
  const from = sp.from ?? fy.from;
  const to = sp.to ?? todayIST();
  const st = await accountStatement(db, a.id, from, to);

  return (
    <>
      <PageHeader
        back={{ href: "/cash-bank", label: "Cash & bank" }}
        title={
          <span className="flex items-center gap-2">
            {a.name} {a.isDefault && <Badge tone="brand">Default</Badge>} {!a.active && <Badge>Inactive</Badge>}
          </span>
        }
        subtitle={
          <span>
            Balance: <Money paise={st.closingPaise} className={st.closingPaise < 0 ? "text-bad font-medium" : "font-medium"} />
          </span>
        }
        actions={
          <>
            <LinkButton size="sm" href={`/transfers/new`}>Transfer</LinkButton>
            {can(user, "money.edit") && <LinkButton size="sm" href={`/cash-bank/${a.id}/edit`}>Edit</LinkButton>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="no-print flex flex-col gap-4">
          <Panel title="Details">
            <dl className="flex flex-col gap-2 text-sm">
              <Detail k="Type" v={a.kind === "cash" ? "Cash" : "Bank"} />
              {a.bankName && <Detail k="Bank" v={a.bankName} />}
              {a.accountNo && <Detail k="Account number" v={a.accountNo} />}
              {a.ifsc && <Detail k="IFSC" v={<span className="font-mono">{a.ifsc}</span>} />}
              {a.upiId && <Detail k="UPI ID" v={a.upiId} />}
            </dl>
          </Panel>
        </div>

        <Panel
          title={`Statement · ${formatDate(from)} – ${formatDate(to)}`}
          padded={false}
          actions={
            <div className="no-print flex flex-wrap items-center gap-2">
              <DateRange from={from} to={to} />
              <PrintButton />
            </div>
          }
        >
          <div className="hidden px-4 pt-4 print:block">
            <div className="text-lg font-semibold">{firm?.name}</div>
            <div className="text-sm">{a.name} — statement</div>
          </div>
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Entry</th>
                <th className={th + " text-right"}>In</th>
                <th className={th + " text-right"}>Out</th>
                <th className={th + " text-right"}>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-ground/40">
                <td className={td}>{formatDate(from)}</td>
                <td className={td + " font-medium"}>Opening balance</td>
                <td className={td} />
                <td className={td} />
                <td className={td + " text-right"}>
                  <Money paise={st.openingPaise} />
                </td>
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
                    {e.party_name && <div className="text-xs text-faint">{e.party_name}{e.payment_mode ? ` · ${e.payment_mode}` : ""}</div>}
                    {!e.party_name && e.voucher_id && e.memo && <div className="text-xs text-faint">{e.memo}</div>}
                  </td>
                  <td className={td + " text-right"}>
                    <Money paise={e.in_paise} blankZero />
                  </td>
                  <td className={td + " text-right"}>
                    <Money paise={e.out_paise} blankZero />
                  </td>
                  <td className={td + " text-right"}>
                    <Money paise={e.balance_paise} className={e.balance_paise < 0 ? "text-bad" : ""} />
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td} />
                <td className={td}>Closing balance</td>
                <td className={td + " text-right"}>
                  <Money paise={st.entries.reduce((s, e) => s + e.in_paise, 0)} />
                </td>
                <td className={td + " text-right"}>
                  <Money paise={st.entries.reduce((s, e) => s + e.out_paise, 0)} />
                </td>
                <td className={td + " text-right"}>
                  <Money paise={st.closingPaise} className={st.closingPaise < 0 ? "text-bad" : ""} />
                </td>
              </tr>
            </tbody>
          </Table>
        </Panel>
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
