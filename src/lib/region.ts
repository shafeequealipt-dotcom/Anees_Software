/**
 * Country settings. One business = one country, chosen at setup and stored on the firm.
 * Everything that differs by country (currency, tax wording, tax ID, states) reads from here.
 *
 * The current region is a module-level value: the server sets it from the database on each
 * request (see app/layout.tsx) and a tiny client component sets it again before the page's own
 * components render, so `formatMoney()` and the labels agree on server and browser.
 */
export type Country = "IN" | "SA";

export interface Region {
  country: Country;
  countryName: string;
  currencyCode: "INR" | "SAR";
  /** Shown before amounts, e.g. "₹" or "SAR". */
  currencySymbol: string;
  currencyMajor: string;
  currencyMinor: string;
  /** "GST" in India, "VAT" in Saudi Arabia. */
  taxName: string;
  /** What the tax registration number is called. */
  taxIdLabel: string;
  taxIdHint: string;
  /** India splits tax into CGST+SGST or IGST by state; Saudi Arabia has one VAT rate. */
  usesStates: boolean;
  /** HSN/SAC codes are an Indian GST return requirement. */
  usesHsn: boolean;
  /** Lakh/crore digit grouping (12,34,567) vs 1,234,567. */
  indianGrouping: boolean;
  timezone: string;
  /** First month of the financial year: April in India, January (calendar year) in Saudi Arabia. */
  financialYearStartMonth: number;
  /** Label for a tax invoice. */
  taxInvoiceTitle: string;
  defaultTaxRates: { name: string; gstBp: number; nature: "taxable" | "exempt" | "nil" | "non_gst"; sort: number; active?: boolean }[];
}

export const REGIONS: Record<Country, Region> = {
  IN: {
    country: "IN",
    countryName: "India",
    currencyCode: "INR",
    currencySymbol: "₹",
    currencyMajor: "Rupees",
    currencyMinor: "Paise",
    taxName: "GST",
    taxIdLabel: "GSTIN",
    taxIdHint: "Leave empty if you're not registered for GST.",
    usesStates: true,
    usesHsn: true,
    indianGrouping: true,
    timezone: "Asia/Kolkata",
    financialYearStartMonth: 4,
    taxInvoiceTitle: "Tax Invoice",
    defaultTaxRates: [
      { name: "GST 0%", gstBp: 0, nature: "taxable", sort: 10 },
      { name: "Exempt", gstBp: 0, nature: "exempt", sort: 11 },
      { name: "Nil rated", gstBp: 0, nature: "nil", sort: 12 },
      { name: "Non-GST", gstBp: 0, nature: "non_gst", sort: 13 },
      { name: "GST 0.25%", gstBp: 25, nature: "taxable", sort: 20 },
      { name: "GST 3%", gstBp: 300, nature: "taxable", sort: 30 },
      { name: "GST 5%", gstBp: 500, nature: "taxable", sort: 40 },
      { name: "GST 18%", gstBp: 1800, nature: "taxable", sort: 60 },
      { name: "GST 40%", gstBp: 4000, nature: "taxable", sort: 80 },
      { name: "GST 12%", gstBp: 1200, nature: "taxable", sort: 50, active: false },
      { name: "GST 28%", gstBp: 2800, nature: "taxable", sort: 70, active: false },
    ],
  },
  SA: {
    country: "SA",
    countryName: "Saudi Arabia",
    currencyCode: "SAR",
    currencySymbol: "SAR",
    currencyMajor: "Riyals",
    currencyMinor: "Halalas",
    taxName: "VAT",
    taxIdLabel: "VAT number (TRN)",
    taxIdHint: "15 digits, starts and ends with 3. Leave empty if you're not VAT-registered.",
    usesStates: false,
    usesHsn: false,
    indianGrouping: false,
    timezone: "Asia/Riyadh",
    financialYearStartMonth: 1,
    taxInvoiceTitle: "Tax Invoice",
    defaultTaxRates: [
      { name: "VAT 15%", gstBp: 1500, nature: "taxable", sort: 10 },
      { name: "Zero-rated (0%)", gstBp: 0, nature: "taxable", sort: 20 },
      { name: "Exempt", gstBp: 0, nature: "exempt", sort: 30 },
      { name: "Out of scope", gstBp: 0, nature: "non_gst", sort: 40 },
    ],
  },
};

let current: Region = REGIONS.IN;

export function setRegion(country: string | null | undefined): Region {
  current = country === "SA" ? REGIONS.SA : REGIONS.IN;
  return current;
}

export function region(): Region {
  return current;
}

/** Tax is stored in the "IGST" column for countries without a state split; show it under the right name. */
export function taxColumnLabels(r: Region = current) {
  return r.usesStates ? { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" } : { cgst: "", sgst: "", igst: r.taxName, cess: "Cess" };
}
