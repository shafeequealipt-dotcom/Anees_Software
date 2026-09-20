CREATE TABLE "user_firms" (
	"user_id" integer NOT NULL,
	"firm_id" integer NOT NULL,
	CONSTRAINT "user_firms_user_id_firm_id_pk" PRIMARY KEY("user_id","firm_id")
);
--> statement-breakpoint
ALTER TABLE "item_categories" DROP CONSTRAINT "item_categories_name_unique";
--> statement-breakpoint
ALTER TABLE "party_groups" DROP CONSTRAINT "party_groups_name_unique";
--> statement-breakpoint
DROP INDEX "items_code_key";
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "ledger_categories" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "party_groups" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "tax_rates" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "firm_id" integer;
--> statement-breakpoint
UPDATE "accounts" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "item_categories" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "items" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "ledger_categories" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "parties" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "party_groups" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "tax_rates" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "units" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "settings" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
UPDATE "audit_log" SET "firm_id" = (SELECT min("id") FROM "firms");
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "item_categories" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ledger_categories" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "parties" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "party_groups" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tax_rates" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "units" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "firm_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey";
--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_firm_id_key_pk" PRIMARY KEY("firm_id","key");
--> statement-breakpoint
ALTER TABLE "user_firms" ADD CONSTRAINT "user_firms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_firms" ADD CONSTRAINT "user_firms_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_categories" ADD CONSTRAINT "ledger_categories_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "party_groups" ADD CONSTRAINT "party_groups_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_firm_name_key" ON "item_categories" USING btree ("firm_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "party_groups_firm_name_key" ON "party_groups" USING btree ("firm_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "items_code_key" ON "items" USING btree ("firm_id","code") WHERE "items"."code" is not null;
--> statement-breakpoint
ALTER TABLE "firms" DROP COLUMN "is_default";
