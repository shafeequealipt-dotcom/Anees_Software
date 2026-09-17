CREATE TYPE "public"."account_kind" AS ENUM('cash', 'bank');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."gst_scheme" AS ENUM('regular', 'composition', 'unregistered');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('goods', 'service');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('voucher', 'opening');--> statement-breakpoint
CREATE TYPE "public"."party_kind" AS ENUM('customer', 'supplier', 'both');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'accountant', 'staff');--> statement-breakpoint
CREATE TYPE "public"."voucher_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."voucher_type" AS ENUM('sale_invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan', 'purchase_bill', 'debit_note', 'purchase_order', 'payment_in', 'payment_out', 'expense', 'other_income', 'stock_adjustment', 'money_adjustment', 'money_transfer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "account_kind" NOT NULL,
	"name" varchar(120) NOT NULL,
	"bank_name" varchar(120),
	"account_no" varchar(40),
	"ifsc" varchar(15),
	"upi_id" varchar(100),
	"opening_balance_paise" bigint DEFAULT 0 NOT NULL,
	"opening_date" date,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_voucher_id" integer NOT NULL,
	"to_voucher_id" integer NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"action" varchar(30) NOT NULL,
	"entity" varchar(40) NOT NULL,
	"entity_id" integer,
	"summary" varchar(300),
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(30) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean NOT NULL,
	"file_name" varchar(200),
	"size_bytes" bigint,
	"message" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "firms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"legal_name" varchar(200),
	"gstin" varchar(15),
	"pan" varchar(10),
	"gst_scheme" "gst_scheme" DEFAULT 'regular' NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"address" text,
	"city" varchar(100),
	"pincode" varchar(10),
	"phone" varchar(30),
	"email" varchar(200),
	"website" varchar(200),
	"logo_path" text,
	"signature_path" text,
	"bank_name" varchar(120),
	"bank_account_no" varchar(40),
	"bank_ifsc" varchar(15),
	"bank_branch" varchar(120),
	"upi_id" varchar(100),
	"invoice_terms" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	CONSTRAINT "item_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "item_kind" DEFAULT 'goods' NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(60),
	"hsn" varchar(10),
	"description" text,
	"category_id" integer,
	"unit_id" integer,
	"alt_unit_id" integer,
	"alt_unit_factor_milli" bigint,
	"sale_price_paise" bigint DEFAULT 0 NOT NULL,
	"sale_price_includes_tax" boolean DEFAULT false NOT NULL,
	"purchase_price_paise" bigint DEFAULT 0 NOT NULL,
	"purchase_price_includes_tax" boolean DEFAULT false NOT NULL,
	"mrp_paise" bigint,
	"tax_rate_id" integer,
	"opening_qty_milli" bigint DEFAULT 0 NOT NULL,
	"opening_rate_paise" bigint DEFAULT 0 NOT NULL,
	"opening_date" date,
	"min_stock_milli" bigint DEFAULT 0 NOT NULL,
	"location" varchar(100),
	"track_batches" boolean DEFAULT false NOT NULL,
	"track_serials" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "category_kind" NOT NULL,
	"name" varchar(120) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(200),
	"ip" varchar(64),
	"ok" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "ledger_source" NOT NULL,
	"voucher_id" integer,
	"account_id" integer NOT NULL,
	"date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"memo" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "party_kind" DEFAULT 'customer' NOT NULL,
	"name" varchar(200) NOT NULL,
	"gstin" varchar(15),
	"pan" varchar(10),
	"phone" varchar(30),
	"email" varchar(200),
	"billing_address" text,
	"shipping_address" text,
	"state_code" varchar(2),
	"group_id" integer,
	"opening_balance_paise" bigint DEFAULT 0 NOT NULL,
	"opening_date" date,
	"credit_days" integer,
	"credit_limit_paise" bigint,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	CONSTRAINT "party_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "party_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "ledger_source" NOT NULL,
	"voucher_id" integer,
	"party_id" integer NOT NULL,
	"date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"memo" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mfa_passed" boolean DEFAULT false NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"token" varchar(64) PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "ledger_source" NOT NULL,
	"voucher_id" integer,
	"line_id" integer,
	"item_id" integer NOT NULL,
	"date" date NOT NULL,
	"qty_milli" bigint NOT NULL,
	"value_paise" bigint DEFAULT 0 NOT NULL,
	"batch_no" varchar(60),
	"expiry_date" date
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"gst_bp" integer DEFAULT 0 NOT NULL,
	"cess_bp" integer DEFAULT 0 NOT NULL,
	"nature" varchar(20) DEFAULT 'taxable' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"code" varchar(10) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(30),
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" integer,
	"description" varchar(300) NOT NULL,
	"hsn" varchar(10),
	"qty_milli" bigint DEFAULT 0 NOT NULL,
	"unit_code" varchar(10),
	"unit_factor_milli" bigint DEFAULT 1000 NOT NULL,
	"rate_paise" bigint DEFAULT 0 NOT NULL,
	"rate_includes_tax" boolean DEFAULT false NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"line_discount_paise" bigint DEFAULT 0 NOT NULL,
	"bill_discount_paise" bigint DEFAULT 0 NOT NULL,
	"gross_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"tax_rate_id" integer,
	"gst_bp" integer DEFAULT 0 NOT NULL,
	"cess_bp" integer DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"cess_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"mrp_paise" bigint,
	"batch_no" varchar(60),
	"mfg_date" date,
	"expiry_date" date,
	"serial_numbers" text[],
	"size" varchar(40),
	"model_no" varchar(60),
	"cost_paise" bigint
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"type" "voucher_type" NOT NULL,
	"prefix" varchar(20) DEFAULT '' NOT NULL,
	"number" integer NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"status" "voucher_status" DEFAULT 'active' NOT NULL,
	"party_id" integer,
	"party_name" varchar(200),
	"party_gstin" varchar(15),
	"party_phone" varchar(30),
	"billing_address" text,
	"shipping_address" text,
	"place_of_supply" varchar(2),
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"without_tax" boolean DEFAULT false NOT NULL,
	"gross_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"bill_discount_paise" bigint DEFAULT 0 NOT NULL,
	"bill_discount_bp" integer DEFAULT 0 NOT NULL,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"cess_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"account_id" integer,
	"to_account_id" integer,
	"payment_mode" varchar(30),
	"payment_ref" varchar(100),
	"direction" integer,
	"category_id" integer,
	"source_voucher_id" integer,
	"original_invoice_no" varchar(60),
	"original_invoice_date" date,
	"supplier_invoice_no" varchar(60),
	"po_number" varchar(60),
	"po_date" date,
	"eway_bill_no" varchar(20),
	"vehicle_no" varchar(20),
	"transport_name" varchar(120),
	"notes" text,
	"terms" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_from_voucher_id_vouchers_id_fk" FOREIGN KEY ("from_voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_to_voucher_id_vouchers_id_fk" FOREIGN KEY ("to_voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_alt_unit_id_units_id_fk" FOREIGN KEY ("alt_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_ledger" ADD CONSTRAINT "money_ledger_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_ledger" ADD CONSTRAINT "money_ledger_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_group_id_party_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."party_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger" ADD CONSTRAINT "party_ledger_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger" ADD CONSTRAINT "party_ledger_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_line_id_voucher_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."voucher_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_category_id_ledger_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ledger_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_from_idx" ON "allocations" USING btree ("from_voucher_id");--> statement-breakpoint
CREATE INDEX "allocations_to_idx" ON "allocations" USING btree ("to_voucher_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "items_name_idx" ON "items" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "items_code_key" ON "items" USING btree ("code") WHERE "items"."code" is not null;--> statement-breakpoint
CREATE INDEX "login_attempts_ip_at_idx" ON "login_attempts" USING btree ("ip","at");--> statement-breakpoint
CREATE INDEX "money_ledger_account_date_idx" ON "money_ledger" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "money_ledger_voucher_idx" ON "money_ledger" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "parties_name_idx" ON "parties" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "parties_phone_idx" ON "parties" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "party_ledger_party_date_idx" ON "party_ledger" USING btree ("party_id","date");--> statement-breakpoint
CREATE INDEX "party_ledger_voucher_idx" ON "party_ledger" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_item_date_idx" ON "stock_ledger" USING btree ("item_id","date");--> statement-breakpoint
CREATE INDEX "stock_ledger_voucher_idx" ON "stock_ledger" USING btree ("voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "voucher_lines_voucher_idx" ON "voucher_lines" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_item_idx" ON "voucher_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_number_key" ON "vouchers" USING btree ("firm_id","type","prefix","number");--> statement-breakpoint
CREATE INDEX "vouchers_type_date_idx" ON "vouchers" USING btree ("type","date");--> statement-breakpoint
CREATE INDEX "vouchers_party_idx" ON "vouchers" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "vouchers_date_idx" ON "vouchers" USING btree ("date");