import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tabs = [
    can(user, "settings.edit") && { href: "/settings/business", label: "This company" },
    can(user, "companies.manage") && { href: "/settings/companies", label: "Companies" },
    can(user, "users.manage") && { href: "/settings/users", label: "Users" },
    can(user, "users.manage") && { href: "/settings/roles", label: "Roles & access" },
    can(user, "settings.edit") && user.firm.country === "SA" && { href: "/settings/einvoicing", label: "E-invoicing" },
    can(user, "settings.edit") && { href: "/settings/preferences", label: "Billing" },
    can(user, "settings.edit") && { href: "/settings/price-lists", label: "Price lists" },
    can(user, "settings.edit") && { href: "/settings/custom-fields", label: "Item fields" },
    can(user, "settings.edit") && { href: "/settings/tax-rates", label: "Tax rates" },
    can(user, "settings.edit") && { href: "/settings/units", label: "Units" },
    can(user, "settings.edit") && { href: "/settings/categories", label: "Categories" },
    can(user, "settings.edit") && { href: "/settings/messaging", label: "Messages" },
    can(user, "audit.view") && { href: "/settings/audit", label: "Activity log" },
    can(user, "backups.manage") && { href: "/settings/backups", label: "Backups" },
  ].filter((t): t is { href: string; label: string } => !!t);
  if (tabs.length === 0) redirect("/?denied=1");
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsTabs tabs={tabs} />
      {children}
    </>
  );
}
