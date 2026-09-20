CREATE TABLE "custom_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"entity" varchar(20) DEFAULT 'item' NOT NULL,
	"name" varchar(60) NOT NULL,
	"kind" varchar(10) DEFAULT 'text' NOT NULL,
	"show_on_invoice" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_firm_name_key" ON "custom_fields" USING btree ("firm_id","entity","name");