import type { VoucherType } from "@/db/schema";

export interface VoucherTypeInfo {
  type: VoucherType;
  label: string;
  plural: string;
  path: string;
  /** Has item lines with quantities and tax. */
  hasLines: boolean;
  /** Which party list to offer. */
  partySide: "customer" | "supplier" | "any" | "none";
  /** Selling price or buying price for items. */
  priceSide: "sale" | "purchase";
  /** Money received/paid on the voucher itself. */
  takesPayment: boolean;
  /** Changes balances, money or stock. */
  posts: boolean;
  /** Voucher types it can be converted into. */
  convertsTo: VoucherType[];
  /** Is this an outward supply for GST (our state is the supplier)? */
  outward: boolean;
}

const T = (x: VoucherTypeInfo) => x;

export const VOUCHER_INFO: Record<VoucherType, VoucherTypeInfo> = {
  sale_invoice: T({ type: "sale_invoice", label: "Sale invoice", plural: "Sale invoices", path: "/sales", hasLines: true, partySide: "customer", priceSide: "sale", takesPayment: true, posts: true, convertsTo: ["credit_note"], outward: true }),
  credit_note: T({ type: "credit_note", label: "Sale return", plural: "Sale returns", path: "/sale-returns", hasLines: true, partySide: "customer", priceSide: "sale", takesPayment: true, posts: true, convertsTo: [], outward: true }),
  quotation: T({ type: "quotation", label: "Quotation", plural: "Quotations", path: "/quotations", hasLines: true, partySide: "customer", priceSide: "sale", takesPayment: false, posts: false, convertsTo: ["sales_order", "sale_invoice"], outward: true }),
  sales_order: T({ type: "sales_order", label: "Sales order", plural: "Sales orders", path: "/sales-orders", hasLines: true, partySide: "customer", priceSide: "sale", takesPayment: false, posts: false, convertsTo: ["sale_invoice", "delivery_challan"], outward: true }),
  delivery_challan: T({ type: "delivery_challan", label: "Delivery challan", plural: "Delivery challans", path: "/delivery-challans", hasLines: true, partySide: "customer", priceSide: "sale", takesPayment: false, posts: false, convertsTo: ["sale_invoice"], outward: true }),
  purchase_bill: T({ type: "purchase_bill", label: "Purchase bill", plural: "Purchase bills", path: "/purchases", hasLines: true, partySide: "supplier", priceSide: "purchase", takesPayment: true, posts: true, convertsTo: ["debit_note"], outward: false }),
  debit_note: T({ type: "debit_note", label: "Purchase return", plural: "Purchase returns", path: "/purchase-returns", hasLines: true, partySide: "supplier", priceSide: "purchase", takesPayment: true, posts: true, convertsTo: [], outward: false }),
  purchase_order: T({ type: "purchase_order", label: "Purchase order", plural: "Purchase orders", path: "/purchase-orders", hasLines: true, partySide: "supplier", priceSide: "purchase", takesPayment: false, posts: false, convertsTo: ["purchase_bill"], outward: false }),
  payment_in: T({ type: "payment_in", label: "Payment in", plural: "Payments in", path: "/payments-in", hasLines: false, partySide: "any", priceSide: "sale", takesPayment: false, posts: true, convertsTo: [], outward: true }),
  payment_out: T({ type: "payment_out", label: "Payment out", plural: "Payments out", path: "/payments-out", hasLines: false, partySide: "any", priceSide: "purchase", takesPayment: false, posts: true, convertsTo: [], outward: false }),
  expense: T({ type: "expense", label: "Expense", plural: "Expenses", path: "/expenses", hasLines: true, partySide: "supplier", priceSide: "purchase", takesPayment: true, posts: true, convertsTo: [], outward: false }),
  other_income: T({ type: "other_income", label: "Other income", plural: "Other income", path: "/other-income", hasLines: true, partySide: "customer", priceSide: "sale", takesPayment: true, posts: true, convertsTo: [], outward: true }),
  stock_adjustment: T({ type: "stock_adjustment", label: "Stock adjustment", plural: "Stock adjustments", path: "/stock-adjustments", hasLines: true, partySide: "none", priceSide: "purchase", takesPayment: false, posts: true, convertsTo: [], outward: false }),
  money_adjustment: T({ type: "money_adjustment", label: "Cash/bank adjustment", plural: "Cash/bank adjustments", path: "/cash-adjustments", hasLines: false, partySide: "none", priceSide: "sale", takesPayment: false, posts: true, convertsTo: [], outward: false }),
  money_transfer: T({ type: "money_transfer", label: "Transfer", plural: "Transfers", path: "/transfers", hasLines: false, partySide: "none", priceSide: "sale", takesPayment: false, posts: true, convertsTo: [], outward: false }),
};

/** Bills that can be settled by payments: which payment type settles which bill types. */
export const SETTLES: Partial<Record<VoucherType, VoucherType[]>> = {
  payment_in: ["sale_invoice", "debit_note"],
  payment_out: ["purchase_bill", "credit_note", "expense"],
  credit_note: ["sale_invoice"],
  debit_note: ["purchase_bill"],
};

export function voucherNumber(v: { prefix: string | null; number: number }): string {
  return `${v.prefix ?? ""}${v.number}`;
}

export function typeFromPath(section: string): VoucherType | null {
  const hit = Object.values(VOUCHER_INFO).find((i) => i.path === `/${section}`);
  return hit ? hit.type : null;
}
