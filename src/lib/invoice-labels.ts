/** English → Arabic wording for everything printed on an invoice. Keyed by the English text so callers never juggle keys. */
export type InvoiceLanguage = "en" | "bilingual" | "ar";

const AR: Record<string, string> = {
  "Tax Invoice": "فاتورة ضريبية",
  Invoice: "فاتورة",
  "Credit Note": "إشعار دائن",
  "Debit Note": "إشعار مدين",
  Quotation: "عرض سعر",
  "Sales Order": "أمر بيع",
  "Delivery Challan": "إشعار تسليم",
  "Purchase Bill": "فاتورة شراء",
  "Purchase Order": "أمر شراء",
  "Payment Receipt": "سند قبض",
  "Payment Voucher": "سند صرف",
  Expense: "مصروف",
  "Other Income": "إيراد آخر",
  "Amounts in": "المبالغ بعملة",
  "Bill to": "فاتورة إلى",
  Supplier: "المورد",
  "Deliver to": "تسليم إلى",
  "Invoice no.": "رقم الفاتورة",
  Date: "التاريخ",
  "Due date": "تاريخ الاستحقاق",
  "Valid until": "صالح حتى",
  "Place of supply": "مكان التوريد",
  "Supplier invoice no.": "رقم فاتورة المورد",
  "PO no.": "رقم أمر الشراء",
  "Original invoice": "الفاتورة الأصلية",
  "Vehicle no.": "رقم المركبة",
  Transport: "الناقل",
  "Reverse charge": "الاحتساب العكسي",
  "Phone:": "الهاتف:",
  "VAT number (TRN)": "الرقم الضريبي",
  Item: "البند",
  Qty: "الكمية",
  Rate: "السعر",
  Discount: "الخصم",
  Taxable: "الخاضع للضريبة",
  "Tax %": "نسبة الضريبة",
  Tax: "الضريبة",
  Amount: "المبلغ",
  HSN: "رمز HSN",
  "Amount in words": "المبلغ كتابةً",
  "Amount before tax": "المبلغ قبل الضريبة",
  "Discount given": "الخصم الممنوح",
  VAT: "ضريبة القيمة المضافة",
  "Round off": "تقريب",
  Total: "الإجمالي",
  Paid: "المدفوع",
  "Balance due": "المتبقي",
  "Total tax": "إجمالي الضريبة",
  "Bank details": "البيانات المصرفية",
  Bank: "البنك",
  "IBAN / account": "الآيبان / الحساب",
  "SWIFT / code": "سويفت / الرمز",
  Branch: "الفرع",
  "Authorised signatory": "التوقيع المعتمد",
  "Terms and conditions": "الشروط والأحكام",
  Notes: "ملاحظات",
  Page: "صفحة",
  of: "من",
  Mode: "طريقة الدفع",
  Reference: "المرجع",
  "Against bills": "مقابل الفواتير",
  "Thank you!": "شكراً لكم!",
  Cash: "نقدي",
  "ZATCA QR code": "رمز الاستجابة السريعة",
  "Sale return": "مردودات مبيعات",
  "Purchase return": "مردودات مشتريات",
};

/** Formats a label for the chosen language: "Total", "Total / الإجمالي" or "الإجمالي". */
export function labeller(mode: InvoiceLanguage) {
  return (en: string): string => {
    const ar = AR[en];
    if (mode === "en" || !ar) return en;
    return mode === "ar" ? ar : `${en} / ${ar}`;
  };
}

export const hasArabic = (s: string | null | undefined) => !!s && /[؀-ۿ]/.test(s);

/** The language a company's invoices use unless the owner chose one. */
export function resolveLanguage(setting: "auto" | InvoiceLanguage, country: "IN" | "SA"): InvoiceLanguage {
  return setting === "auto" ? (country === "SA" ? "bilingual" : "en") : setting;
}
