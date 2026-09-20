import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import { settings } from "@/db/schema";
import type { VoucherType } from "@/db/schema";

/** Business preferences with their defaults. Stored as key/value rows. */
export const DEFAULT_SETTINGS = {
  roundOff: true,
  allowNegativeStock: true,
  creditLimitMode: "warn" as "off" | "warn" | "block",
  showLowStockWarning: true,
  defaultPriceIncludesTax: false,
  lineDiscount: true,
  billDiscount: true,
  showMrp: false,
  batchTracking: false,
  serialTracking: false,
  quantityDecimals: 2,
  invoiceLayout: "classic" as "classic" | "modern",
  invoiceAccentColor: "#1f4e79",
  printPaperSize: "A4" as "A4" | "A5",
  showBankDetailsOnInvoice: true,
  showUpiQrOnInvoice: true,
  showSignatureBox: true,
  showHsnSummary: true,
  showPartyBalanceOnInvoice: false,
  thermalWidthMm: 80 as 58 | 80,
  idleLogoutMinutes: 120,
  requireDeletePin: false,
  prefixes: {
    sale_invoice: "INV-",
    credit_note: "CN-",
    quotation: "QT-",
    sales_order: "SO-",
    delivery_challan: "DC-",
    purchase_bill: "",
    debit_note: "DN-",
    purchase_order: "PO-",
    payment_in: "RCPT-",
    payment_out: "PAY-",
    expense: "EXP-",
    other_income: "INC-",
    stock_adjustment: "ADJ-",
    money_adjustment: "CADJ-",
    money_transfer: "TRF-",
  } as Record<VoucherType, string>,
  documentTitles: {
    sale_invoice: "Tax Invoice",
    credit_note: "Credit Note",
    quotation: "Quotation",
    sales_order: "Sales Order",
    delivery_challan: "Delivery Challan",
    purchase_bill: "Purchase Bill",
    debit_note: "Debit Note",
    purchase_order: "Purchase Order",
    payment_in: "Payment Receipt",
    payment_out: "Payment Voucher",
    expense: "Expense",
    other_income: "Other Income",
    stock_adjustment: "Stock Adjustment",
    money_adjustment: "Cash/Bank Adjustment",
    money_transfer: "Money Transfer",
  } as Record<VoucherType, string>,
  quotationTerms: "This quotation is valid for 15 days.",
  reminderMessage:
    "Dear {party}, a payment of {amount} is pending with {business}. Kindly pay at the earliest. Thank you.",
  financialYearStartMonth: 4,
  // Messaging (WhatsApp / email)
  notifyOwnerPhone: "",
  notifyOwnerEmail: "",
  notifyOwnerOnNewTransaction: false,
  notifyPartyOnChange: false,
  paymentReminders: false,
  reminderFirstAfterDays: 1,
  reminderEveryDays: 7,
  reminderMaxCount: 3,
  tdsTcsEnabled: false,
  serviceReminders: false,
  serviceLeadDays: 3,
  serviceMessage: "Dear {party}, your {item} is due for service on {date}. Please contact {business} to book a visit. Thank you.",
  // Set once the double-entry books have been built from existing bills.
  glBuiltAt: "",
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

export async function getSettings(db: DB | Tx, firmId: number): Promise<Settings> {
  const rows = await db.select().from(settings).where(eq(settings.firmId, firmId));
  const out = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>;
  for (const r of rows) {
    if (!(r.key in out)) continue;
    const def = out[r.key];
    // Some database drivers hand back a JSON string twice-decoded ("9811122233" becomes the number 9811122233); keep text settings as text.
    const raw = typeof def === "string" && typeof r.value !== "string" ? String(r.value) : r.value;
    out[r.key] =
      def && typeof def === "object" && !Array.isArray(def) ? { ...(def as object), ...(r.value as object) } : raw;
  }
  return out as Settings;
}

export async function saveSettings(db: DB | Tx, firmId: number, patch: Partial<Settings>) {
  const entries = Object.entries(patch).filter(([k]) => k in DEFAULT_SETTINGS);
  for (const [key, value] of entries) {
    await db
      .insert(settings)
      .values({ firmId, key, value: value as object })
      .onConflictDoUpdate({ target: [settings.firmId, settings.key], set: { value: value as object, updatedAt: sql`now()` } });
  }
}

export async function deleteSettings(db: DB | Tx, firmId: number, keys: SettingKey[]) {
  if (keys.length) await db.delete(settings).where(and(eq(settings.firmId, firmId), inArray(settings.key, keys)));
}
