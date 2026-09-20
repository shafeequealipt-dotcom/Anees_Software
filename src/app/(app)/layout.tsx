import Link from "next/link";
import { logoutAction, businessName } from "@/app/actions/auth";
import { Nav, type NavGroup } from "@/components/nav";
import { GlobalSearch } from "@/components/search";
import { buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const name = await businessName();

  const groups: NavGroup[] = [
    { items: [{ href: "/", label: "Home" }] },
    {
      label: "Sales",
      items: [
        { href: "/sales", label: "Sale invoices" },
        { href: "/payments-in", label: "Payments in" },
        { href: "/quotations", label: "Quotations" },
        { href: "/sales-orders", label: "Sales orders" },
        { href: "/delivery-challans", label: "Delivery challans" },
        { href: "/sale-returns", label: "Sale returns" },
      ],
    },
    {
      label: "Purchases",
      items: [
        { href: "/purchases", label: "Purchase bills" },
        { href: "/payments-out", label: "Payments out" },
        { href: "/purchase-orders", label: "Purchase orders" },
        { href: "/purchase-returns", label: "Purchase returns" },
      ],
    },
    {
      label: "Accounts",
      items: [
        { href: "/parties", label: "Parties" },
        { href: "/items", label: "Items & stock" },
        { href: "/expenses", label: "Expenses" },
        ...(can(user, "money.view")
          ? [
              { href: "/other-income", label: "Other income" },
              { href: "/cash-bank", label: "Cash & bank" },
            ]
          : []),
      ],
    },
    {
      items: [
        { href: "/reports", label: "Reports" },
        ...(can(user, "settings.edit") || can(user, "users.manage") || can(user, "audit.view") ? [{ href: "/settings", label: "Settings" }] : []),
      ],
    },
  ];

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="flex flex-col bg-brand-900 max-lg:contents">
        <div className="no-print hidden border-b border-white/10 px-5 py-4 lg:block">
          <div className="truncate text-sm font-semibold text-white" title={name}>
            {name}
          </div>
          <div className="text-xs text-brand-200/70">Billing & accounts</div>
        </div>
        <Nav groups={groups} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 pl-24 lg:pl-4">
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/sales/new" className={buttonClass("primary", "sm")}>
              + Sale
            </Link>
            <Link href="/purchases/new" className={buttonClass("secondary", "sm") + " max-sm:hidden"}>
              + Purchase
            </Link>
            <details className="relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm hover:bg-ground">
                <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-md:hidden">{user.name}</span>
              </summary>
              <div className="absolute right-0 top-10 z-50 w-56 rounded-lg border border-line bg-panel py-1 shadow-lg">
                <div className="border-b border-line px-3 py-2">
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-muted">
                    {user.email} · {user.roleName}
                  </div>
                </div>
                <Link href="/account" className="block px-3 py-2 text-sm hover:bg-ground">
                  My password & sign-in
                </Link>
                <form action={logoutAction}>
                  <button type="submit" className="block w-full px-3 py-2 text-left text-sm text-bad hover:bg-bad-bg">
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{user.mustChangePassword ? <ChangePasswordForm forced /> : children}</div>
        </main>
      </div>
    </div>
  );
}
