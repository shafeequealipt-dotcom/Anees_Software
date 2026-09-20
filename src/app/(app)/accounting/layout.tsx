import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { ensureGlBuilt } from "@/server/gl";

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("accounting.view");
  await ensureGlBuilt(await getDb(), user.firmId);
  return (
    <>
      <PageHeader title="Accounting" />
      <SettingsTabs
        tabs={[
          { href: "/accounting/accounts", label: "Chart of accounts" },
          { href: "/accounting/journal", label: "Journal entries" },
          { href: "/accounting/trial-balance", label: "Trial balance" },
          { href: "/accounting/balance-sheet", label: "Balance sheet" },
          { href: "/accounting/assets", label: "Fixed assets" },
        ]}
      />
      {children}
    </>
  );
}
