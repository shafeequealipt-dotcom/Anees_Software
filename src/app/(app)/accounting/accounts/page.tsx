import Link from "next/link";
import { AccountManager } from "@/components/accounting-forms";
import { Badge, Panel, Table, td, th } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listGlAccounts, trialBalance } from "@/server/gl";
import { todayIST } from "@/lib/dates";
import { Money } from "@/components/ui";

export const metadata = { title: "Chart of accounts" };

const ORDER = ["asset", "liability", "equity", "income", "expense"];
const TITLE: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };

export default async function ChartPage() {
  const user = await requireUser("accounting.view");
  const db = await getDb();
  const [accounts, tb] = await Promise.all([listGlAccounts(db, user.firmId), trialBalance(db, user.firmId, todayIST())]);
  const bal = new Map(tb.map((r) => [r.id, r.net]));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Every bill posts to these accounts automatically. Accounts marked automatic are kept up to date for you (cash and bank accounts, expense categories, sales, tax and so on). Add your own for loans, capital, prepaid expenses and the like.</p>
      {ORDER.map((t) => (
        <Panel key={t} title={TITLE[t]} padded={false}>
          <Table>
            <tbody>
              {accounts
                .filter((a) => a.type === t)
                .map((a) => (
                  <tr key={a.id} className={a.active ? "" : "opacity-60"}>
                    <td className={td + " w-20 font-mono text-xs"}>{a.code}</td>
                    <td className={td}>
                      <Link href={`/accounting/accounts/${a.id}`} className="text-brand-600 hover:underline">
                        {a.name}
                      </Link>{" "}
                      {a.key ? <Badge tone="neutral">automatic</Badge> : null} {!a.active && <Badge>hidden</Badge>}
                      <div className="text-xs text-faint">{a.grp}</div>
                    </td>
                    <td className={td + " text-right"}>{bal.has(a.id) ? <Money paise={Math.abs(bal.get(a.id)!)} /> : ""} <span className="text-xs text-faint">{bal.get(a.id) ? (bal.get(a.id)! > 0 ? "Dr" : "Cr") : ""}</span></td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Panel>
      ))}
      {can(user, "accounting.edit") && <AccountManager accounts={accounts.filter((a) => !a.key).map((a) => ({ id: a.id, name: a.name, type: a.type as "asset", grp: a.grp ?? "", active: a.active }))} />}
    </div>
  );
}
