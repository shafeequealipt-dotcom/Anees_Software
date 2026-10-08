import { PreferencesForm } from "@/components/preferences-form";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getDb } from "@/db";
import { previewNextProductId } from "@/server/masters";

export const metadata = { title: "Billing preferences" };

export default async function PreferencesPage() {
  const user = await requireUser("settings.edit");
  const db = await getDb();
  const s = await getSettings(db, user.firmId);
  const nextProductId = await previewNextProductId(db, user.firmId);
  return (
    <PreferencesForm
      initial={{
        creditLimitMode: s.creditLimitMode,
        allowNegativeStock: s.allowNegativeStock,
        defaultLowStock: s.defaultLowStock,
        productIdMode: s.productIdMode,
        productIdPrefix: s.productIdPrefix,
        productIdDigits: s.productIdDigits,
        roundOff: s.roundOff,
        lineDiscount: s.lineDiscount,
        billDiscount: s.billDiscount,
        defaultPriceIncludesTax: s.defaultPriceIncludesTax,
        showMrp: s.showMrp,
        invoiceLanguage: s.invoiceLanguage,
        printPaperSize: s.printPaperSize,
        thermalWidthMm: s.thermalWidthMm,
        invoiceLayout: s.invoiceLayout,
        invoiceAccentColor: s.invoiceAccentColor,
        showBankDetailsOnInvoice: s.showBankDetailsOnInvoice,
        showUpiQrOnInvoice: s.showUpiQrOnInvoice,
        tdsTcsEnabled: s.tdsTcsEnabled,
        quotationTerms: s.quotationTerms,
        prefixes: s.prefixes,
      }}
      india={user.firm.country === "IN"}
      nextProductId={nextProductId}
    />
  );
}
