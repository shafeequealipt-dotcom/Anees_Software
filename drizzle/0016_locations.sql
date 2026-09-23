CREATE TYPE "public"."location_kind" AS ENUM('warehouse', 'shop');--> statement-breakpoint
ALTER TYPE "public"."voucher_type" ADD VALUE 'stock_transfer' BEFORE 'money_adjustment';--> statement-breakpoint
CREATE TABLE "item_location_levels" (
	"item_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"min_stock_milli" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "item_location_levels_item_id_location_id_pk" PRIMARY KEY("item_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "item_openings" (
	"item_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"qty_milli" bigint DEFAULT 0 NOT NULL,
	"rate_paise" bigint DEFAULT 0 NOT NULL,
	"date" date,
	CONSTRAINT "item_openings_item_id_location_id_pk" PRIMARY KEY("item_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" "location_kind" DEFAULT 'shop' NOT NULL,
	"code" varchar(20),
	"address" text,
	"phone" varchar(30),
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_locations" (
	"user_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	CONSTRAINT "user_locations_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
-- Nullable for now: backfilled below, then locked to NOT NULL once every existing row has a location.
ALTER TABLE "stock_ledger" ADD COLUMN "location_id" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "location_id" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "to_location_id" integer;--> statement-breakpoint
ALTER TABLE "item_location_levels" ADD CONSTRAINT "item_location_levels_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_location_levels" ADD CONSTRAINT "item_location_levels_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_openings" ADD CONSTRAINT "item_openings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_openings" ADD CONSTRAINT "item_openings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_firm_name_key" ON "locations" USING btree ("firm_id","name");--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_ledger_item_location_idx" ON "stock_ledger" USING btree ("item_id","location_id");--> statement-breakpoint

-- ─── Backfill: every existing firm gets a Warehouse and a Main shop; all existing stock, bills and
-- item openings move to Main shop. Totals are unchanged, so books and reports stay identical.
INSERT INTO "locations" ("firm_id", "name", "kind", "sort")
	SELECT "id", 'Warehouse', 'warehouse', 0 FROM "firms";
--> statement-breakpoint
INSERT INTO "locations" ("firm_id", "name", "kind", "sort")
	SELECT "id", 'Main shop', 'shop', 1 FROM "firms";
--> statement-breakpoint
UPDATE "stock_ledger" SET "location_id" = (
	SELECT "l"."id" FROM "locations" "l"
	JOIN "items" "i" ON "i"."firm_id" = "l"."firm_id"
	WHERE "i"."id" = "stock_ledger"."item_id" AND "l"."name" = 'Main shop'
) WHERE "location_id" IS NULL;
--> statement-breakpoint
UPDATE "vouchers" SET "location_id" = (
	SELECT "l"."id" FROM "locations" "l" WHERE "l"."firm_id" = "vouchers"."firm_id" AND "l"."name" = 'Main shop'
) WHERE "location_id" IS NULL;
--> statement-breakpoint
INSERT INTO "item_openings" ("item_id", "location_id", "qty_milli", "rate_paise", "date")
	SELECT "i"."id", "l"."id", "i"."opening_qty_milli", "i"."opening_rate_paise", "i"."opening_date"
	FROM "items" "i"
	JOIN "locations" "l" ON "l"."firm_id" = "i"."firm_id" AND "l"."name" = 'Main shop';
--> statement-breakpoint
ALTER TABLE "stock_ledger" ALTER COLUMN "location_id" SET NOT NULL;--> statement-breakpoint

-- Accountants keep seeing/using every shop after upgrade (matches their existing company-wide view).
UPDATE "roles" SET "permissions" = "permissions" || '["locations.all"]'::jsonb WHERE "name" = 'Accountant' AND "is_system";
