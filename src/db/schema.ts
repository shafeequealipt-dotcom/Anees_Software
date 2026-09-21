import { sql } from "drizzle-orm";
import {
  customType,
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/*
 * Conventions
 *  - Money: bigint paise.  Quantity: bigint thousandths.  Percent: integer basis points.
 *  - Every business event is a "voucher". Saving a voucher rewrites its rows in the three
 *    ledgers (party, money, stock); balances and reports are sums over those ledgers.
 */

const paise = (name: string) => bigint(name, { mode: "number" });
const milli = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const partyKind = pgEnum("party_kind", ["customer", "supplier", "both"]);
export const itemKind = pgEnum("item_kind", ["goods", "service"]);
export const accountKind = pgEnum("account_kind", ["cash", "bank"]);
export const gstScheme = pgEnum("gst_scheme", ["regular", "composition", "unregistered"]);
export const categoryKind = pgEnum("category_kind", ["expense", "income"]);
export const voucherStatus = pgEnum("voucher_status", ["active", "cancelled", "deleted"]);
export const ledgerSource = pgEnum("ledger_source", ["voucher", "opening"]);

export const VOUCHER_TYPES = [
  "sale_invoice",
  "credit_note", // sale return
  "quotation",
  "sales_order",
  "delivery_challan",
  "purchase_bill",
  "debit_note", // purchase return
  "purchase_order",
  "payment_in",
  "payment_out",
  "expense",
  "other_income",
  "stock_adjustment",
  "money_adjustment",
  "money_transfer",
] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];
export const voucherType = pgEnum("voucher_type", VOUCHER_TYPES);

// ─── Business & people ────────────────────────────────────────────────────────

export const firms = pgTable("firms", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  /** Arabic name and address, printed on bilingual invoices. */
  nameAr: varchar("name_ar", { length: 200 }),
  addressAr: text("address_ar"),
  legalName: varchar("legal_name", { length: 200 }),
  gstin: varchar("gstin", { length: 15 }),
  pan: varchar("pan", { length: 10 }),
  gstScheme: gstScheme("gst_scheme").notNull().default("regular"),
  /** "IN" (India, GST) or "SA" (Saudi Arabia, VAT). Chosen at setup. */
  country: varchar("country", { length: 2 }).notNull().default("IN"),
  /** Only used in India (CGST/SGST vs IGST). Optional. */
  stateCode: varchar("state_code", { length: 2 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  pincode: varchar("pincode", { length: 10 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 200 }),
  website: varchar("website", { length: 200 }),
  logoPath: text("logo_path"),
  signaturePath: text("signature_path"),
  bankName: varchar("bank_name", { length: 120 }),
  bankAccountNo: varchar("bank_account_no", { length: 40 }),
  bankIfsc: varchar("bank_ifsc", { length: 15 }),
  bankBranch: varchar("bank_branch", { length: 120 }),
  upiId: varchar("upi_id", { length: 100 }),
  invoiceTerms: text("invoice_terms"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A named set of permissions. The owner role has every permission and cannot be edited. */
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 60 }).notNull().unique(),
  description: varchar("description", { length: 300 }),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  isOwner: boolean("is_owner").notNull().default(false),
  /** Built-in roles cannot be deleted. */
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    passwordHash: text("password_hash").notNull(),
    roleId: integer("role_id").notNull().references(() => roles.id),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    active: boolean("active").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

/** Which companies a non-owner user may open. Owners can open every company. */
export const userFirms = pgTable(
  "user_firms",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    firmId: integer("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.firmId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // sha256 of the cookie token
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    /** The company this session is currently working in. */
    firmId: integer("firm_id").references(() => firms.id, { onDelete: "set null" }),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 200 }),
    ip: varchar("ip", { length: 64 }),
    ok: boolean("ok").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_at_idx").on(t.ip, t.at)],
);

export const settings = pgTable(
  "settings",
  {
    firmId: integer("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 100 }).notNull(),
    value: jsonb("value").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.firmId, t.key] })],
);

// ─── Masters ──────────────────────────────────────────────────────────────────

export const taxRates = pgTable("tax_rates", {
  id: serial("id").primaryKey(),
  firmId: integer("firm_id").notNull().references(() => firms.id),
  name: varchar("name", { length: 60 }).notNull(),
  gstBp: integer("gst_bp").notNull().default(0),
  cessBp: integer("cess_bp").notNull().default(0),
  /** "taxable", "exempt", "nil", "non_gst" — matters for GST returns. */
  nature: varchar("nature", { length: 20 }).notNull().default("taxable"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  firmId: integer("firm_id").notNull().references(() => firms.id),
  name: varchar("name", { length: 60 }).notNull(),
  /** Unique Quantity Code used in GST returns, e.g. NOS, KGS, BOX. */
  code: varchar("code", { length: 10 }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const itemCategories = pgTable(
  "item_categories",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    name: varchar("name", { length: 120 }).notNull(),
  },
  (t) => [uniqueIndex("item_categories_firm_name_key").on(t.firmId, t.name)],
);

export const items = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    kind: itemKind("kind").notNull().default("goods"),
    name: varchar("name", { length: 200 }).notNull(),
    nameAr: varchar("name_ar", { length: 200 }),
    code: varchar("code", { length: 60 }),
    hsn: varchar("hsn", { length: 10 }),
    description: text("description"),
    categoryId: integer("category_id").references(() => itemCategories.id, { onDelete: "set null" }),
    unitId: integer("unit_id").references(() => units.id),
    altUnitId: integer("alt_unit_id").references(() => units.id),
    /** How many base units make one alternate unit, in thousandths (1 box = 12 pcs → 12000). */
    altUnitFactorMilli: milli("alt_unit_factor_milli"),
    salePricePaise: paise("sale_price_paise").notNull().default(0),
    salePriceIncludesTax: boolean("sale_price_includes_tax").notNull().default(false),
    purchasePricePaise: paise("purchase_price_paise").notNull().default(0),
    purchasePriceIncludesTax: boolean("purchase_price_includes_tax").notNull().default(false),
    mrpPaise: paise("mrp_paise"),
    taxRateId: integer("tax_rate_id").references(() => taxRates.id),
    openingQtyMilli: milli("opening_qty_milli").notNull().default(0),
    openingRatePaise: paise("opening_rate_paise").notNull().default(0),
    openingDate: date("opening_date"),
    minStockMilli: milli("min_stock_milli").notNull().default(0),
    location: varchar("location", { length: 100 }),
    trackBatches: boolean("track_batches").notNull().default(false),
    trackSerials: boolean("track_serials").notNull().default(false),
    /** Remind the customer to book a service this many days after buying (null = no reminder). */
    serviceIntervalDays: integer("service_interval_days"),
    /** Values of the company's custom item fields, keyed by field id. */
    customValues: jsonb("custom_values").$type<Record<string, string>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("items_name_idx").on(sql`lower(${t.name})`),
    uniqueIndex("items_code_key").on(t.firmId, t.code).where(sql`${t.code} is not null`),
  ],
);

/** Extra fields the owner adds to items (e.g. Brand, Warranty, Shelf life). */
export const customFields = pgTable(
  "custom_fields",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    entity: varchar("entity", { length: 20 }).notNull().default("item"),
    name: varchar("name", { length: 60 }).notNull(),
    kind: varchar("kind", { length: 10 }).notNull().default("text"),
    showOnInvoice: boolean("show_on_invoice").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("custom_fields_firm_name_key").on(t.firmId, t.entity, t.name)],
);

/** Named price lists (e.g. Retail, Wholesale). A party can be put on one; items carry a price per list. */
export const priceLists = pgTable(
  "price_lists",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    name: varchar("name", { length: 80 }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("price_lists_firm_name_key").on(t.firmId, t.name)],
);

export const partyGroups = pgTable(
  "party_groups",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    name: varchar("name", { length: 120 }).notNull(),
  },
  (t) => [uniqueIndex("party_groups_firm_name_key").on(t.firmId, t.name)],
);

export const parties = pgTable(
  "parties",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    kind: partyKind("kind").notNull().default("customer"),
    name: varchar("name", { length: 200 }).notNull(),
    nameAr: varchar("name_ar", { length: 200 }),
    addressAr: text("address_ar"),
    /** Saudi national address, needed on business-to-business e-invoices. */
    saStreet: varchar("sa_street", { length: 120 }),
    saBuilding: varchar("sa_building", { length: 10 }),
    saDistrict: varchar("sa_district", { length: 80 }),
    saCity: varchar("sa_city", { length: 80 }),
    saPostal: varchar("sa_postal", { length: 10 }),
    gstin: varchar("gstin", { length: 15 }),
    pan: varchar("pan", { length: 10 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 200 }),
    billingAddress: text("billing_address"),
    shippingAddress: text("shipping_address"),
    stateCode: varchar("state_code", { length: 2 }),
    groupId: integer("group_id").references(() => partyGroups.id, { onDelete: "set null" }),
    priceListId: integer("price_list_id").references(() => priceLists.id, { onDelete: "set null" }),
    /** Positive: they owe us (receivable). Negative: we owe them (payable). */
    openingBalancePaise: paise("opening_balance_paise").notNull().default(0),
    openingDate: date("opening_date"),
    creditDays: integer("credit_days"),
    creditLimitPaise: paise("credit_limit_paise"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("parties_name_idx").on(sql`lower(${t.name})`), index("parties_phone_idx").on(t.phone)],
);

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  firmId: integer("firm_id").notNull().references(() => firms.id),
  kind: accountKind("kind").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  bankName: varchar("bank_name", { length: 120 }),
  accountNo: varchar("account_no", { length: 40 }),
  ifsc: varchar("ifsc", { length: 15 }),
  upiId: varchar("upi_id", { length: 100 }),
  openingBalancePaise: paise("opening_balance_paise").notNull().default(0),
  openingDate: date("opening_date"),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const ledgerCategories = pgTable("ledger_categories", {
  id: serial("id").primaryKey(),
  firmId: integer("firm_id").notNull().references(() => firms.id),
  kind: categoryKind("kind").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
});

// ─── Vouchers ─────────────────────────────────────────────────────────────────

export const vouchers = pgTable(
  "vouchers",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    type: voucherType("type").notNull(),
    prefix: varchar("prefix", { length: 20 }).notNull().default(""),
    number: integer("number").notNull(),
    date: date("date").notNull(),
    dueDate: date("due_date"),
    status: voucherStatus("status").notNull().default("active"),

    partyId: integer("party_id").references(() => parties.id),
    partyName: varchar("party_name", { length: 200 }),
    partyGstin: varchar("party_gstin", { length: 15 }),
    partyPhone: varchar("party_phone", { length: 30 }),
    billingAddress: text("billing_address"),
    shippingAddress: text("shipping_address"),
    placeOfSupply: varchar("place_of_supply", { length: 2 }),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    withoutTax: boolean("without_tax").notNull().default(false),

    grossPaise: paise("gross_paise").notNull().default(0),
    discountPaise: paise("discount_paise").notNull().default(0),
    billDiscountPaise: paise("bill_discount_paise").notNull().default(0),
    billDiscountBp: integer("bill_discount_bp").notNull().default(0),
    taxablePaise: paise("taxable_paise").notNull().default(0),
    cgstPaise: paise("cgst_paise").notNull().default(0),
    sgstPaise: paise("sgst_paise").notNull().default(0),
    igstPaise: paise("igst_paise").notNull().default(0),
    cessPaise: paise("cess_paise").notNull().default(0),
    roundOffPaise: paise("round_off_paise").notNull().default(0),
    totalPaise: paise("total_paise").notNull().default(0),

    /** Money received/paid at the time of the voucher (or the whole amount for payments/expenses). */
    paidPaise: paise("paid_paise").notNull().default(0),
    accountId: integer("account_id").references(() => accounts.id),
    toAccountId: integer("to_account_id").references(() => accounts.id),
    paymentMode: varchar("payment_mode", { length: 30 }),
    paymentRef: varchar("payment_ref", { length: 100 }),
    /** +1 increase / −1 decrease, for stock and money adjustments. */
    direction: integer("direction"),
    categoryId: integer("category_id").references(() => ledgerCategories.id),

    sourceVoucherId: integer("source_voucher_id"),
    originalInvoiceNo: varchar("original_invoice_no", { length: 60 }),
    originalInvoiceDate: date("original_invoice_date"),
    supplierInvoiceNo: varchar("supplier_invoice_no", { length: 60 }),
    poNumber: varchar("po_number", { length: 60 }),
    poDate: date("po_date"),
    ewayBillNo: varchar("eway_bill_no", { length: 20 }),
    vehicleNo: varchar("vehicle_no", { length: 20 }),
    transportName: varchar("transport_name", { length: 120 }),
    notes: text("notes"),
    terms: text("terms"),

    createdBy: integer("created_by").references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    /** Deleted bills are hidden, keep their number, and can be restored from the snapshot of their ledger entries. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: integer("deleted_by").references(() => users.id),
    deletedSnapshot: jsonb("deleted_snapshot"),
    /** Expenses: is the tax on this bill claimable as input tax credit? */
    itcEligible: boolean("itc_eligible").notNull().default(true),
    /** India: tax collected at source by the seller (added to the bill total). */
    tcsBp: integer("tcs_bp").notNull().default(0),
    tcsPaise: paise("tcs_paise").notNull().default(0),
    /** India: tax deducted at source by the payer (the payer pays us / we pay the supplier this much less). */
    tdsBp: integer("tds_bp").notNull().default(0),
    tdsPaise: paise("tds_paise").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("vouchers_number_key").on(t.firmId, t.type, t.prefix, t.number),
    index("vouchers_type_date_idx").on(t.type, t.date),
    index("vouchers_party_idx").on(t.partyId),
    index("vouchers_date_idx").on(t.date),
  ],
);

export const voucherLines = pgTable(
  "voucher_lines",
  {
    id: serial("id").primaryKey(),
    voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    itemId: integer("item_id").references(() => items.id),
    description: varchar("description", { length: 300 }).notNull(),
    hsn: varchar("hsn", { length: 10 }),
    qtyMilli: milli("qty_milli").notNull().default(0),
    unitCode: varchar("unit_code", { length: 10 }),
    /** Base units per unit used on this line, in thousandths (1000 = base unit). */
    unitFactorMilli: milli("unit_factor_milli").notNull().default(1000),
    ratePaise: paise("rate_paise").notNull().default(0),
    rateIncludesTax: boolean("rate_includes_tax").notNull().default(false),
    discountBp: integer("discount_bp").notNull().default(0),
    lineDiscountPaise: paise("line_discount_paise").notNull().default(0),
    billDiscountPaise: paise("bill_discount_paise").notNull().default(0),
    grossPaise: paise("gross_paise").notNull().default(0),
    taxablePaise: paise("taxable_paise").notNull().default(0),
    taxRateId: integer("tax_rate_id").references(() => taxRates.id),
    gstBp: integer("gst_bp").notNull().default(0),
    cessBp: integer("cess_bp").notNull().default(0),
    cgstPaise: paise("cgst_paise").notNull().default(0),
    sgstPaise: paise("sgst_paise").notNull().default(0),
    igstPaise: paise("igst_paise").notNull().default(0),
    cessPaise: paise("cess_paise").notNull().default(0),
    totalPaise: paise("total_paise").notNull().default(0),
    mrpPaise: paise("mrp_paise"),
    batchNo: varchar("batch_no", { length: 60 }),
    mfgDate: date("mfg_date"),
    expiryDate: date("expiry_date"),
    serialNumbers: text("serial_numbers").array(),
    size: varchar("size", { length: 40 }),
    modelNo: varchar("model_no", { length: 60 }),
    /** For stock adjustments on purchase-type vouchers: cost value of the movement. */
    costPaise: paise("cost_paise"),
  },
  (t) => [index("voucher_lines_voucher_idx").on(t.voucherId), index("voucher_lines_item_idx").on(t.itemId)],
);

/** Payment-in / payment-out / returns settled against specific bills. */
export const allocations = pgTable(
  "allocations",
  {
    id: serial("id").primaryKey(),
    fromVoucherId: integer("from_voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    toVoucherId: integer("to_voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    amountPaise: paise("amount_paise").notNull(),
  },
  (t) => [index("allocations_from_idx").on(t.fromVoucherId), index("allocations_to_idx").on(t.toVoucherId)],
);

// ─── Ledgers (derived from vouchers and opening balances) ─────────────────────

export const partyLedger = pgTable(
  "party_ledger",
  {
    id: serial("id").primaryKey(),
    source: ledgerSource("source").notNull(),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "cascade" }),
    partyId: integer("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Positive increases what the party owes us. */
    amountPaise: paise("amount_paise").notNull(),
    memo: varchar("memo", { length: 200 }),
  },
  (t) => [index("party_ledger_party_date_idx").on(t.partyId, t.date), index("party_ledger_voucher_idx").on(t.voucherId)],
);

export const moneyLedger = pgTable(
  "money_ledger",
  {
    id: serial("id").primaryKey(),
    source: ledgerSource("source").notNull(),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Positive is money coming in. */
    amountPaise: paise("amount_paise").notNull(),
    memo: varchar("memo", { length: 200 }),
  },
  (t) => [index("money_ledger_account_date_idx").on(t.accountId, t.date), index("money_ledger_voucher_idx").on(t.voucherId)],
);

export const stockLedger = pgTable(
  "stock_ledger",
  {
    id: serial("id").primaryKey(),
    source: ledgerSource("source").notNull(),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "cascade" }),
    lineId: integer("line_id").references(() => voucherLines.id, { onDelete: "cascade" }),
    itemId: integer("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Positive is stock coming in, in base units (thousandths). */
    qtyMilli: milli("qty_milli").notNull(),
    /** Value at cost for inward movements (purchases, opening, increases). */
    valuePaise: paise("value_paise").notNull().default(0),
    batchNo: varchar("batch_no", { length: 60 }),
    expiryDate: date("expiry_date"),
  },
  (t) => [index("stock_ledger_item_date_idx").on(t.itemId, t.date), index("stock_ledger_voucher_idx").on(t.voucherId)],
);

// ─── Operations ───────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    firmId: integer("firm_id").references(() => firms.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 30 }).notNull(),
    entity: varchar("entity", { length: 40 }).notNull(),
    entityId: integer("entity_id"),
    summary: varchar("summary", { length: 300 }),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: varchar("ip", { length: 64 }),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_at_idx").on(t.at)],
);

export const backupRuns = pgTable("backup_runs", {
  id: serial("id").primaryKey(),
  kind: varchar("kind", { length: 30 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok").notNull(),
  fileName: varchar("file_name", { length: 200 }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  message: text("message"),
  details: jsonb("details"),
});

export const shareLinks = pgTable("share_links", {
  token: varchar("token", { length: 64 }).primaryKey(),
  voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** "Your AC service is due": one row per sold item that has a service interval. */
export const serviceReminders = pgTable(
  "service_reminders",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    partyId: integer("party_id").references(() => parties.id, { onDelete: "cascade" }),
    itemId: integer("item_id").references(() => items.id, { onDelete: "set null" }),
    itemName: varchar("item_name", { length: 300 }).notNull(),
    dueDate: date("due_date").notNull(),
    /** pending, done (customer was serviced or reminder dismissed) */
    status: varchar("status", { length: 10 }).notNull().default("pending"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("service_reminders_due_idx").on(t.firmId, t.status, t.dueDate), index("service_reminders_voucher_idx").on(t.voucherId)],
);

/** Which orders/challans a bill was made from (a bill can combine several). */
export const voucherSources = pgTable(
  "voucher_sources",
  {
    voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    sourceId: integer("source_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.voucherId, t.sourceId] }), index("voucher_sources_source_idx").on(t.sourceId)],
);

/** Messages waiting to be sent (or already sent) by WhatsApp or email: payment reminders, alerts to the owner, updates to parties. */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 30 }).notNull(),
    channel: varchar("channel", { length: 12 }).notNull(),
    toAddress: varchar("to_address", { length: 200 }).notNull(),
    toName: varchar("to_name", { length: 200 }),
    subject: varchar("subject", { length: 200 }),
    body: text("body").notNull(),
    /** pending = will be sent automatically; manual = needs a person to tap the WhatsApp link; sent; failed; cancelled */
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    dedupeKey: varchar("dedupe_key", { length: 120 }),
    refType: varchar("ref_type", { length: 30 }),
    refId: integer("ref_id"),
    partyId: integer("party_id"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_key").on(t.firmId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("notifications_status_idx").on(t.status, t.scheduledFor),
    index("notifications_firm_created_idx").on(t.firmId, t.createdAt),
  ],
);

export const itemPrices = pgTable(
  "item_prices",
  {
    priceListId: integer("price_list_id").notNull().references(() => priceLists.id, { onDelete: "cascade" }),
    itemId: integer("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    salePricePaise: paise("sale_price_paise").notNull(),
    includesTax: boolean("includes_tax").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.priceListId, t.itemId] })],
);

/** A special rate (or a percentage off the list price) for one party and one item. */
export const partyRates = pgTable(
  "party_rates",
  {
    partyId: integer("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
    itemId: integer("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    ratePaise: paise("rate_paise"),
    discountBp: integer("discount_bp"),
  },
  (t) => [primaryKey({ columns: [t.partyId, t.itemId] })],
);

// ─── Accounting (double entry) ────────────────────────────────────────────────

/** The chart of accounts. Some accounts are created automatically (cash, receivables, sales…) and marked with a `key`. */
export const glAccounts = pgTable(
  "gl_accounts",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    code: varchar("code", { length: 12 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    /** asset, liability, equity, income or expense */
    type: varchar("type", { length: 10 }).notNull(),
    /** Section on the balance sheet or profit and loss, e.g. "Current assets". */
    grp: varchar("grp", { length: 40 }),
    /** Set for accounts the system maintains: 'receivable', 'sales', 'money:12', 'cat:3' … */
    key: varchar("key", { length: 40 }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("gl_accounts_firm_key").on(t.firmId, t.key).where(sql`${t.key} is not null`), uniqueIndex("gl_accounts_firm_code").on(t.firmId, t.code)],
);

/** Manual journal entries (for things that are not bills: loans, capital, corrections). */
export const journals = pgTable(
  "journals",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    number: integer("number").notNull(),
    date: date("date").notNull(),
    narration: varchar("narration", { length: 300 }),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("journals_firm_number").on(t.firmId, t.number)],
);

/** Every debit and credit. Bills, openings, journals and depreciation all end up here; a source's entries always balance. */
export const glEntries = pgTable(
  "gl_entries",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    date: date("date").notNull(),
    accountId: integer("account_id").notNull().references(() => glAccounts.id),
    debitPaise: paise("debit_paise").notNull().default(0),
    creditPaise: paise("credit_paise").notNull().default(0),
    /** voucher | opening | journal | asset */
    source: varchar("source", { length: 10 }).notNull(),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "cascade" }),
    journalId: integer("journal_id").references(() => journals.id, { onDelete: "cascade" }),
    /** For openings and assets: which master row, e.g. 'party:12', 'asset:3:dep:2026'. */
    refKey: varchar("ref_key", { length: 60 }),
    memo: varchar("memo", { length: 200 }),
  },
  (t) => [index("gl_entries_account_date_idx").on(t.accountId, t.date), index("gl_entries_voucher_idx").on(t.voucherId), index("gl_entries_ref_idx").on(t.firmId, t.refKey), index("gl_entries_firm_date_idx").on(t.firmId, t.date)],
);

export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    name: varchar("name", { length: 150 }).notNull(),
    category: varchar("category", { length: 60 }).notNull().default("Equipment"),
    purchaseDate: date("purchase_date").notNull(),
    costPaise: paise("cost_paise").notNull(),
    salvagePaise: paise("salvage_paise").notNull().default(0),
    /** straight_line or reducing (written-down value) */
    method: varchar("method", { length: 14 }).notNull().default("straight_line"),
    /** Yearly rate in basis points (1500 = 15%). */
    rateBp: integer("rate_bp").notNull(),
    /** Where the money came from when it was bought: an account id, or null for an asset the business already owned. */
    paidFromAccountId: integer("paid_from_account_id").references(() => accounts.id),
    disposedOn: date("disposed_on"),
    disposalPaise: paise("disposal_paise"),
    notes: varchar("notes", { length: 300 }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("fixed_assets_firm_idx").on(t.firmId)],
);

/** "Back up now" requests from the Backups page. The server's backup job picks these up within a couple of minutes. */
export const backupRequests = pgTable("backup_requests", {
  id: serial("id").primaryKey(),
  requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  /** pending, running, done, failed */
  status: varchar("status", { length: 10 }).notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  message: text("message"),
});

const bytea = customType<{ data: Buffer; driverData: Buffer | string }>({
  dataType: () => "bytea",
  toDriver: (v) => v,
  fromDriver: (v) => (typeof v === "string" ? Buffer.from(v.replace(/^\\x/, ""), "hex") : Buffer.from(v)),
});

/** A company's logo and signature image, kept in the database so backups include them. */
export const firmImages = pgTable(
  "firm_images",
  {
    firmId: integer("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 10 }).notNull(),
    mime: varchar("mime", { length: 30 }).notNull(),
    data: bytea("data").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.firmId, t.kind] })],
);

// ─── ZATCA e-invoicing (Saudi Arabia, Phase 2) ───────────────────────────────

/** One row per company. Keys and secrets are stored encrypted with the server's APP_SECRET. */
export const zatcaSettings = pgTable("zatca_settings", {
  firmId: integer("firm_id").primaryKey().references(() => firms.id, { onDelete: "cascade" }),
  /** sandbox, simulation or production */
  environment: varchar("environment", { length: 12 }).notNull().default("sandbox"),
  /** not_started, csr_ready, compliance, production */
  status: varchar("status", { length: 12 }).notNull().default("not_started"),
  enabled: boolean("enabled").notNull().default(false),
  crn: varchar("crn", { length: 20 }),
  branchName: varchar("branch_name", { length: 100 }),
  businessCategory: varchar("business_category", { length: 100 }),
  shortAddress: varchar("short_address", { length: 12 }),
  street: varchar("street", { length: 120 }),
  building: varchar("building", { length: 10 }),
  district: varchar("district", { length: 80 }),
  city: varchar("city", { length: 80 }),
  postal: varchar("postal", { length: 10 }),
  egsSerial: varchar("egs_serial", { length: 80 }),
  privateKeyEnc: text("private_key_enc"),
  csr: text("csr"),
  complianceCert: text("compliance_cert"),
  complianceSecretEnc: text("compliance_secret_enc"),
  complianceRequestId: varchar("compliance_request_id", { length: 40 }),
  productionCert: text("production_cert"),
  productionSecretEnc: text("production_secret_enc"),
  /** The chain: how many invoices have been issued, and the hash of the last one. */
  icv: integer("icv").notNull().default(0),
  lastHash: text("last_hash"),
  lastCheck: jsonb("last_check"),
  updatedAt: updatedAt(),
});

export const zatcaInvoices = pgTable(
  "zatca_invoices",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id").notNull().references(() => firms.id),
    voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    uuid: varchar("uuid", { length: 40 }).notNull(),
    icv: integer("icv").notNull(),
    kind: varchar("kind", { length: 12 }).notNull(),
    invoiceHash: text("invoice_hash").notNull(),
    qr: text("qr").notNull(),
    xml: text("xml").notNull(),
    clearedXml: text("cleared_xml"),
    /** pending, reported, cleared, rejected */
    status: varchar("status", { length: 10 }).notNull().default("pending"),
    response: jsonb("response"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("zatca_invoices_voucher_key").on(t.voucherId), uniqueIndex("zatca_invoices_icv_key").on(t.firmId, t.icv), index("zatca_invoices_status_idx").on(t.firmId, t.status)],
);
