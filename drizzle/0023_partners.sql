CREATE TABLE "partner_payout_links" (
	"token" varchar(64) PRIMARY KEY NOT NULL,
	"payout_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"partner_id" integer NOT NULL,
	"month" varchar(7) NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"rate_per_million_paise" bigint DEFAULT 0 NOT NULL,
	"views_amount_paise" bigint DEFAULT 0 NOT NULL,
	"views_description" varchar(200),
	"invoice_no" varchar(40),
	"invoice_date" date,
	"period" varchar(60),
	"invoice_notes" text,
	"payee" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"payout_id" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"channel_name" varchar(160),
	"handle" varchar(80),
	"kind" varchar(15) DEFAULT 'national' NOT NULL,
	"country" varchar(80),
	"address" text,
	"pan" varchar(20),
	"phone" varchar(30),
	"email" varchar(200),
	"instagram" varchar(120),
	"facebook" varchar(120),
	"telegram" varchar(120),
	"tiktok" varchar(120),
	"youtube_url" varchar(300),
	"rate_per_million_paise" bigint DEFAULT 0 NOT NULL,
	"bank_holder" varchar(120),
	"bank_name" varchar(120),
	"bank_account_no" varchar(40),
	"bank_branch" varchar(120),
	"bank_ifsc" varchar(15),
	"upi_id" varchar(100),
	"bank_swift" varchar(15),
	"bank_iban" varchar(40),
	"bank_address" text,
	"joined_on" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "partner_id" integer;--> statement-breakpoint
ALTER TABLE "partner_payout_links" ADD CONSTRAINT "partner_payout_links_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."partner_payouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_promotions" ADD CONSTRAINT "partner_promotions_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."partner_payouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payouts_month_key" ON "partner_payouts" USING btree ("partner_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payouts_invoice_key" ON "partner_payouts" USING btree ("firm_id",lower("invoice_no")) WHERE "partner_payouts"."invoice_no" is not null;--> statement-breakpoint
CREATE INDEX "partner_payouts_firm_month_idx" ON "partner_payouts" USING btree ("firm_id","month");--> statement-breakpoint
CREATE INDEX "partner_promotions_payout_idx" ON "partner_promotions" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "partners_firm_idx" ON "partners" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_code_lower_key" ON "partners" USING btree ("firm_id",lower("code"));--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vouchers_partner_idx" ON "vouchers" USING btree ("partner_id","pay_month");--> statement-breakpoint

-- The built-in "Company owner" role gets the new Partners permission (the Owner role has every permission already).
UPDATE "roles" SET "permissions" = "permissions" || '["partners.manage"]'::jsonb
	WHERE lower("name") = 'company owner' AND "is_system" AND NOT ("permissions" ? 'partners.manage');
