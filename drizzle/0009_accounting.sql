CREATE TABLE "fixed_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"category" varchar(60) DEFAULT 'Equipment' NOT NULL,
	"purchase_date" date NOT NULL,
	"cost_paise" bigint NOT NULL,
	"salvage_paise" bigint DEFAULT 0 NOT NULL,
	"method" varchar(14) DEFAULT 'straight_line' NOT NULL,
	"rate_bp" integer NOT NULL,
	"paid_from_account_id" integer,
	"disposed_on" date,
	"disposal_paise" bigint,
	"notes" varchar(300),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(10) NOT NULL,
	"grp" varchar(40),
	"key" varchar(40),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"date" date NOT NULL,
	"account_id" integer NOT NULL,
	"debit_paise" bigint DEFAULT 0 NOT NULL,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"source" varchar(10) NOT NULL,
	"voucher_id" integer,
	"journal_id" integer,
	"ref_key" varchar(60),
	"memo" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"number" integer NOT NULL,
	"date" date NOT NULL,
	"narration" varchar(300),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "itc_eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_paid_from_account_id_accounts_id_fk" FOREIGN KEY ("paid_from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_account_id_gl_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fixed_assets_firm_idx" ON "fixed_assets" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_firm_key" ON "gl_accounts" USING btree ("firm_id","key") WHERE "gl_accounts"."key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_firm_code" ON "gl_accounts" USING btree ("firm_id","code");--> statement-breakpoint
CREATE INDEX "gl_entries_account_date_idx" ON "gl_entries" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "gl_entries_voucher_idx" ON "gl_entries" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "gl_entries_ref_idx" ON "gl_entries" USING btree ("firm_id","ref_key");--> statement-breakpoint
CREATE INDEX "gl_entries_firm_date_idx" ON "gl_entries" USING btree ("firm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_firm_number" ON "journals" USING btree ("firm_id","number");
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || '["accounting.view","accounting.edit"]'::jsonb WHERE "name" = 'Accountant' AND "is_system";
