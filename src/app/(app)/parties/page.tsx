import Link from "next/link";
import { Empty, LinkButton, Money, PageHeader, Panel, PartyBalance, Table, td, th } from "@/components/ui";
import { SearchBox, Tabs } from "@/components/simple-filters";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { region } from "@/lib/region";
import { partyBalances } from "@/server/reports";

export const metadata = { title: "Parties" };

export default async function PartiesPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; kind?: string }> }) {
  const user = await requireUser();
  const seeBalance = can(user, "see.partyBalance");
  const seeContact = can(user, "see.partyContact");
  const sp = await searchParams;
  const db = await getDb();
  let list = await partyBalances(db, user.firmId, { q: sp.q, kind: sp.kind, includeInactive: sp.show === "inactive" });
  if (seeBalance && sp.show === "receivable") list = list.filter((p) => p.balance_paise > 0);
  if (seeBalance && sp.show === "payable") list = list.filter((p) => p.balance_paise < 0);
  if (sp.show === "inactive") list = list.filter((p) => !p.active);
  const receivable = list.reduce((s, p) => s + Math.max(0, p.balance_paise), 0);
  const payable = list.reduce((s, p) => s + Math.max(0, -p.balance_paise), 0);

  return (
    <>
      <PageHeader
        title="Parties"
        subtitle="Customers and suppliers with what they owe you, or you owe them."
        actions={
          <>
            <LinkButton href="/parties/import" size="md">Import from Excel</LinkButton>
            <a href="/api/export/parties" className="inline-flex h-9 items-center rounded-md border border-line bg-panel px-3.5 text-sm font-medium hover:bg-ground">Export</a>
            <LinkButton href="/parties/new" variant="primary">+ Add party</LinkButton>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="show"
          current={sp.show ?? "all"}
          options={[
            { value: "all", label: "All" },
            ...(seeBalance ? [{ value: "receivable", label: "To receive" }, { value: "payable", label: "To pay" }] : []),
            { value: "inactive", label: "Inactive" },
          ]}
        />
        <Tabs param="kind" current={sp.kind ?? "all"} options={[{ value: "all", label: "Everyone" }, { value: "customer", label: "Customers" }, { value: "supplier", label: "Suppliers" }]} />
        <SearchBox q={sp.q} placeholder={seeContact ? `Name, phone or ${region().taxIdLabel}` : "Name"} />
      </div>
      {seeBalance && <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg border border-line bg-panel px-3 py-2">
          <div className="text-xs text-muted">To receive</div>
          <Money paise={receivable} className="font-semibold text-good" />
        </div>
        <div className="rounded-lg border border-line bg-panel px-3 py-2">
          <div className="text-xs text-muted">To pay</div>
          <Money paise={payable} className="font-semibold text-bad" />
        </div>
      </div>}
      <Panel padded={false}>
        {list.length === 0 ? (
          <Empty title={sp.q ? `No party matches “${sp.q}”` : "No parties yet"} action={<LinkButton href="/parties/new" variant="primary">+ Add party</LinkButton>}>
            Add your customers and suppliers, or import them from an Excel sheet.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Name</th>
                {seeContact && <th className={th}>Phone</th>}
                {seeContact && <th className={th}>{region().taxIdLabel}</th>}
                <th className={th}>Group</th>
                <th className={th}>Last entry</th>
                {seeBalance && <th className={th + " text-right"}>Balance</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-ground/60">
                  <td className={td}>
                    <Link href={`/parties/${p.id}`} className="font-medium text-brand-600 hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-faint">{p.kind === "both" ? "Customer & supplier" : p.kind === "customer" ? "Customer" : "Supplier"}</div>
                  </td>
                  {seeContact && <td className={td}>{p.phone}</td>}
                  {seeContact && <td className={td + " font-mono text-xs"}>{p.gstin}</td>}
                  <td className={td}>{p.group_name}</td>
                  <td className={td + " text-muted"}>{formatDate(p.last_date)}</td>
                  {seeBalance && (
                    <td className={td + " text-right"}>
                      <PartyBalance paise={p.balance_paise} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
