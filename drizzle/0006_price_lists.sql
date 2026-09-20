CREATE TABLE "item_prices" (
	"price_list_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"sale_price_paise" bigint NOT NULL,
	"includes_tax" boolean DEFAULT false NOT NULL,
	CONSTRAINT "item_prices_price_list_id_item_id_pk" PRIMARY KEY("price_list_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "party_rates" (
	"party_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"rate_paise" bigint,
	"discount_bp" integer,
	CONSTRAINT "party_rates_party_id_item_id_pk" PRIMARY KEY("party_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "price_list_id" integer;--> statement-breakpoint
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_prices" ADD CONSTRAINT "item_prices_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rates" ADD CONSTRAINT "party_rates_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_rates" ADD CONSTRAINT "party_rates_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_firm_name_key" ON "price_lists" USING btree ("firm_id","name");--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || '["see.profit","vouchers.restore"]'::jsonb WHERE "name" = 'Accountant' AND "is_system";
