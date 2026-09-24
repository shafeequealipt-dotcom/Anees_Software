import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firms } from "@/db/schema";
import { type InvoiceLanguage, labeller, resolveLanguage } from "@/lib/invoice-labels";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { setRegion } from "@/lib/region";
import { getSettings } from "@/lib/settings";
import { imageDataUrls } from "./company-images";
import { dailySalesReport } from "./reports";

export type ReportPaper = "A4" | "T80" | "T58";

export interface DailyReportModel {
  paper: ReportPaper;
  language: InvoiceLanguage;
  ui: Record<string, string>;
  title: string;
  companyName: string;
  companyNameAr: string | null;
  locationLabel: string;
  dateLabel: string;
  currency: string;
  logo: string | null;
  summary: { k: string; v: string; bold?: boolean }[];
  byPaymentMode: { mode: string; amount: string }[];
  topItems: { name: string; qty: string; amount: string }[];
  byStaff: { name: string; bills: string; sales: string; returns: string }[];
  fileName: string;
}

export async function loadDailyReportModel(db: DB, firmId: number, date: string, locationId: number | undefined, opts: { paper?: ReportPaper } = {}): Promise<DailyReportModel | null> {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) return null;
  const settings = await getSettings(db, firmId);
  const r = await dailySalesReport(db, firmId, date, locationId);
  const images = await imageDataUrls(db, firmId);

  const R = setRegion(firm.country);
  const money = (p: number) => formatMoney(p, { symbol: false });
  const language = resolveLanguage(settings.invoiceLanguage, firm.country === "SA" ? "SA" : "IN");
  const L = labeller(language);
  const paper: ReportPaper = opts.paper ?? (settings.printPaperSize === "thermal" ? (settings.thermalWidthMm === 58 ? "T58" : "T80") : "A4");

  const summary: DailyReportModel["summary"] = [
    { k: L("Bills"), v: String(r.bills) },
    { k: L("Gross sales"), v: money(r.grossSalesPaise) },
  ];
  if (r.discountPaise > 0) summary.push({ k: L("Discount"), v: `-${money(r.discountPaise)}` });
  if (r.taxPaise > 0) summary.push({ k: L("Total tax"), v: money(r.taxPaise) });
  summary.push({ k: `${L("Sale return")} (${r.returnCount})`, v: r.returnsPaise > 0 ? `-${money(r.returnsPaise)}` : money(0) });
  summary.push({ k: L("Net sales"), v: money(r.netSalesPaise), bold: true });
  summary.push({ k: L("Paid on bill"), v: money(r.paidOnBillPaise) });
  if (r.paymentsReceivedPaise > 0) summary.push({ k: L("Payments received"), v: money(r.paymentsReceivedPaise) });
  if (r.unpaidPaise > 0) summary.push({ k: L("Balance due"), v: money(r.unpaidPaise) });

  return {
    paper,
    language,
    ui: { Total: L("Total"), Item: L("Item"), Qty: L("Qty"), Amount: L("Amount"), Mode: L("Mode"), "Thank you!": L("Thank you!") },
    title: L("Daily Sales Report"),
    companyName: firm.name,
    companyNameAr: language !== "en" ? firm.nameAr : null,
    locationLabel: r.locationName ?? L("All shops"),
    dateLabel: formatDate(date),
    currency: R.currencyCode,
    logo: images.logo,
    summary,
    byPaymentMode: r.byPaymentMode.map((m) => ({ mode: m.mode, amount: money(m.amountPaise) })),
    topItems: r.topItems.slice(0, 10).map((i) => ({ name: i.name, qty: `${formatQty(i.qtyMilli)} ${i.unitCode ?? ""}`.trim(), amount: money(i.amountPaise) })),
    byStaff: r.byStaff.map((s) => ({ name: s.name, bills: String(s.bills), sales: money(s.salesPaise), returns: s.returnsPaise > 0 ? money(s.returnsPaise) : "" })),
    fileName: `daily-sales-${date}${r.locationName ? `-${r.locationName.replace(/[^A-Za-z0-9]+/g, "-")}` : ""}.pdf`,
  };
}
