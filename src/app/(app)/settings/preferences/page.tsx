import { PreferencesForm } from "@/components/preferences-form";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getDb } from "@/db";

export const metadata = { title: "Billing preferences" };

export default async function PreferencesPage() {
  const user = await requireUser("settings.edit");
  const s = await getSettings(await getDb(), user.firmId);
  return (
    <PreferencesForm
      initial={{
        creditLimitMode: s.creditLimitMode,
        allowNegativeStock: s.allowNegativeStock,
        roundOff: s.roundOff,
        lineDiscount: s.lineDiscount,
        billDiscount: s.billDiscount,
        defaultPriceIncludesTax: s.defaultPriceIncludesTax,
        showMrp: s.showMrp,
        printPaperSize: s.printPaperSize,
        showBankDetailsOnInvoice: s.showBankDetailsOnInvoice,
        showUpiQrOnInvoice: s.showUpiQrOnInvoice,
        tdsTcsEnabled: s.tdsTcsEnabled,
        quotationTerms: s.quotationTerms,
        prefixes: s.prefixes,
      }}
      india={user.firm.country === "IN"}
    />
  );
}
