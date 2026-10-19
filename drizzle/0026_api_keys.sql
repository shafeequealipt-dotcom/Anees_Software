CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"hint" varchar(12) NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "external_ref" varchar(120);--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_firm_idx" ON "api_keys" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_external_ref_key" ON "vouchers" USING btree ("firm_id","external_ref") WHERE "vouchers"."external_ref" is not null;