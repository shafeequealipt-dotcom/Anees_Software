import Link from "next/link";
import { logoutAction, businessName } from "@/app/actions/auth";
import { Nav, type NavGroup } from "@/components/nav";
import { Suspense } from "react";
import { BackButton } from "@/components/back-nav";
import { GlobalSearch } from "@/components/search";
import { buttonClass } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { partnersEnabled } from "@/server/partners";
import { can } from "@/lib/permissions";
import { ChangePasswordForm } from "@/components/change-password-form";
import { CompanySwitcher } from "@/components/company-switcher";
import { HoverMenu } from "@/components/hover-menu";
import { LanguageToggle } from "@/components/language-toggle";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const name = await businessName();
  const lang = (await cookies()).get("lang")?.value === "ar" ? "ar" : "en";
  const partnersOn = can(user, "partners.manage") && (await partnersEnabled(await getDb(), user.firmId));

  const groups: NavGroup[] = [
    { items: [{ href: "/", label: "Home", icon: "home" }] },
    {
      label: "Sales",
      icon: "sales",
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
      icon: "purchases",
      items: [
        { href: "/purchases", label: "Purchase bills" },
        { href: "/payments-out", label: "Payments out" },
        { href: "/purchase-orders", label: "Purchase orders" },
        { href: "/purchase-returns", label: "Purchase returns" },
      ],
    },
    {
      label: "Accounts",
      icon: "accounts",
      items: [
        { href: "/parties", label: "Parties" },
        { href: "/items", label: "Items & stock" },
        { href: "/stock-transfers", label: "Stock transfers" },
        { href: "/damaged-goods", label: "Damaged goods" },
        { href: "/expenses", label: "Expenses" },
        ...(can(user, "staff.manage") ? [{ href: "/staff", label: "Staff & salaries" }] : []),
        ...(partnersOn && can(user, "partners.manage") ? [{ href: "/partners", label: "Partners" }] : []),
        { href: "/services", label: "Service reminders" },
        ...(can(user, "money.view")
          ? [
              { href: "/other-income", label: "Other income" },
              { href: "/cash-bank", label: "Cash & bank" },
            ]
          : []),
      ],
    },
    ...(can(user, "accounting.view") ? [{ label: "Books", icon: "books" as const, items: [{ href: "/accounting", label: "Accounting" }] }] : []),
    {
      items: [
        { href: "/reports", label: "Reports", icon: "reports" },
        ...(can(user, "vouchers.restore") ? [{ href: "/deleted", label: "Deleted entries", icon: "trash" as const }] : []),
        ...(can(user, "settings.edit") || can(user, "users.manage") || can(user, "audit.view") || can(user, "companies.manage") ? [{ href: "/settings", label: "Settings", icon: "settings" as const }] : []),
      ],
    },
  ];

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <div className="flex min-h-0 flex-col bg-gradient-to-b from-[#241f63] via-brand-900 to-[#171341] max-lg:contents print:hidden">
        <div className="no-print hidden border-b border-white/10 px-5 py-4 lg:block">
          <div className="truncate text-sm font-semibold text-white" title={name}>
            {name}
          </div>
          <div className="text-xs text-brand-200/70">Billing & accounts</div>
        </div>
        <Nav groups={groups} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Left padding below lg leaves room for the fixed Menu button (wider once it shows its label). */}
        <header className="no-print flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-panel pl-16 pr-2 shadow-sm shadow-ink/[0.03] sm:gap-3 sm:pl-32 sm:pr-4 lg:pl-4">
          <Suspense fallback={null}>
            <BackButton />
          </Suspense>
          <GlobalSearch />
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <CompanySwitcher current={user.firm} companies={user.firms} canManage={can(user, "companies.manage")} />
            <Link href="/sales/new" className={buttonClass("primary", "sm")} title="New sale invoice">
              <span aria-hidden="true">+</span>
              <span className="max-sm:hidden"> Sale</span>
            </Link>
            <Link href="/purchases/new" className={buttonClass("secondary", "sm") + " max-sm:hidden"}>
              + Purchase
            </Link>
            <HoverMenu
              panelClassName="w-56 rounded-lg border border-line bg-panel py-1 shadow-lg"
              trigger={
                <span className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-ground">
                  <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-semibold text-white shadow-sm">
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-md:hidden">{user.name}</span>
                </span>
              }
            >
              <div className="border-b border-line px-3 py-2">
                <div className="text-sm font-medium">{user.name}</div>
                <div className="text-xs text-muted">
                  {user.email} · {user.roleName}
                </div>
              </div>
              <LanguageToggle lang={lang} />
              <Link href="/account" className="block px-3 py-2 text-sm hover:bg-ground">
                My password & sign-in
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="block w-full px-3 py-2 text-left text-sm text-bad hover:bg-bad-bg">
                  Sign out
                </button>
              </form>
            </HoverMenu>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{user.mustChangePassword ? <ChangePasswordForm forced /> : children}</div>
        </main>
      </div>
    </div>
  );
}
