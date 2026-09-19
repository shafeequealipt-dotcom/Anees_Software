import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const metadata = { title: "Reports" };

const GROUPS: { title: string; items: { href: string; label: string; hint: string }[] }[] = [
  {
    title: "Money",
    items: [
      { href: "/reports/day-book", label: "Day book", hint: "Every entry on a given day" },
      { href: "/reports/profit-loss", label: "Profit & loss", hint: "Sales, cost of goods, expenses" },
      { href: "/sales?status=open", label: "Unpaid sales", hint: "Who owes you money" },
      { href: "/purchases?status=open", label: "Unpaid purchases", hint: "What you owe suppliers" },
    ],
  },
  {
    title: "Sales & purchases",
    items: [
      { href: "/sales", label: "Sale invoices", hint: "Filter, search, export" },
      { href: "/purchases", label: "Purchase bills", hint: "Filter, search, export" },
      { href: "/reports/item-sales?side=sale", label: "Item-wise sales", hint: "Best-selling items" },
      { href: "/reports/item-sales?side=purchase", label: "Item-wise purchases", hint: "What you buy most" },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/reports/stock-summary", label: "Stock summary", hint: "Quantity and value on hand" },
      { href: "/reports/low-stock", label: "Low stock", hint: "Items at or below the alert level" },
    ],
  },
  {
    title: "Tax",
    items: [{ href: "/reports/tax", label: "Tax report", hint: "Tax collected and paid, by rate" }],
  },
];

export default async function ReportsPage() {
  const user = await requireUser("reports.sales");
  const seeAll = can(user.role, "reports.all");

  return (
    <>
      <PageHeader title="Reports" />
      <div className="grid gap-4 sm:grid-cols-2">
        {GROUPS.filter((g) => seeAll || g.title !== "Money").map((g) => (
          <Panel key={g.title} title={g.title} padded={false}>
            <ul className="divide-y divide-line">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link href={it.href} className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-ground/60">
                    <span className="font-medium text-brand-600">{it.label}</span>
                    <span className="text-xs text-muted">{it.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
