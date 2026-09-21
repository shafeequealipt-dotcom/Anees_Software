CREATE TABLE "zatca_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"voucher_id" integer NOT NULL,
	"uuid" varchar(40) NOT NULL,
	"icv" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"invoice_hash" text NOT NULL,
	"qr" text NOT NULL,
	"xml" text NOT NULL,
	"cleared_xml" text,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"response" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zatca_settings" (
	"firm_id" integer PRIMARY KEY NOT NULL,
	"environment" varchar(12) DEFAULT 'sandbox' NOT NULL,
	"status" varchar(12) DEFAULT 'not_started' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"crn" varchar(20),
	"branch_name" varchar(100),
	"business_category" varchar(100),
	"short_address" varchar(12),
	"street" varchar(120),
	"building" varchar(10),
	"district" varchar(80),
	"city" varchar(80),
	"postal" varchar(10),
	"egs_serial" varchar(80),
	"private_key_enc" text,
	"csr" text,
	"compliance_cert" text,
	"compliance_secret_enc" text,
	"compliance_request_id" varchar(40),
	"production_cert" text,
	"production_secret_enc" text,
	"icv" integer DEFAULT 0 NOT NULL,
	"last_hash" text,
	"last_check" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "sa_street" varchar(120);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "sa_building" varchar(10);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "sa_district" varchar(80);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "sa_city" varchar(80);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "sa_postal" varchar(10);--> statement-breakpoint
ALTER TABLE "zatca_invoices" ADD CONSTRAINT "zatca_invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zatca_invoices" ADD CONSTRAINT "zatca_invoices_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zatca_settings" ADD CONSTRAINT "zatca_settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zatca_invoices_voucher_key" ON "zatca_invoices" USING btree ("voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zatca_invoices_icv_key" ON "zatca_invoices" USING btree ("firm_id","icv");--> statement-breakpoint
CREATE INDEX "zatca_invoices_status_idx" ON "zatca_invoices" USING btree ("firm_id","status");