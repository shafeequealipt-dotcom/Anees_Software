import Link from "next/link";
import { sql } from "drizzle-orm";
import { Badge, Empty, LinkButton, Money, PageHeader, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { nums, rows } from "@/db/query";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const metadata = { title: "Cash & bank" };

export default async function CashBankPage() {
  const user = await requireUser("money.view");
  const db = await getDb();
  const list = nums(
    await rows<{ id: number; kind: string; name: string; bankName: string | null; accountNo: string | null; active: boolean; isDefault: boolean; balance: number }>(
      db,
      sql`select a.id, a.kind, a.name, a.bank_name as "bankName", a.account_no as "accountNo", a.active, a.is_default as "isDefault",
            coalesce(sum(m.amount_paise), 0) as balance
          from accounts a left join money_ledger m on m.account_id = a.id
          where a.active
          group by a.id order by a.kind, lower(a.name)`,
    ),
    ["balance"],
  );
  const total = list.reduce((s, a) => s + a.balance, 0);

  return (
    <>
      <PageHeader
        title="Cash & bank"
        subtitle="Every account's balance is the sum of its transactions — nothing is entered by hand."
        actions={
          <>
            {can(user, "money.edit") && (
              <>
                <LinkButton href="/transfers/new" size="md">Transfer money</LinkButton>
                <LinkButton href="/cash-adjustments/new" size="md">Adjust balance</LinkButton>
                <LinkButton href="/cash-bank/new" variant="primary">+ Add bank account</LinkButton>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 max-w-xs rounded-lg border border-line bg-panel px-3 py-2">
        <div className="text-xs text-muted">Total across all accounts</div>
        <Money paise={total} className="text-lg font-semibold" />
      </div>
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title="No accounts yet" action={<LinkButton href="/cash-bank/new" variant="primary">+ Add bank account</LinkButton>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Account</th>
                <th className={th}>Type</th>
                <th className={th}>Details</th>
                <th className={th + " text-right"}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="hover:bg-ground/60">
                  <td className={td}>
                    <Link href={`/cash-bank/${a.id}`} className="font-medium text-brand-600 hover:underline">
                      {a.name}
                    </Link>
                    {a.isDefault && (
                      <>
                        {" "}
                        <Badge tone="brand">Default</Badge>
                      </>
                    )}
                  </td>
                  <td className={td}>{a.kind === "cash" ? "Cash" : "Bank"}</td>
                  <td className={td + " text-muted"}>{a.bankName}{a.accountNo ? ` · ···${a.accountNo.slice(-4)}` : ""}</td>
                  <td className={td + " text-right"}>
                    <Money paise={a.balance} className={a.balance < 0 ? "text-bad" : ""} />
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td} colSpan={3}>
                  Total
                </td>
                <td className={td + " text-right"}>
                  <Money paise={total} />
                </td>
              </tr>
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
