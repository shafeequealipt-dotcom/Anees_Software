CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"channel" varchar(12) NOT NULL,
	"to_address" varchar(200) NOT NULL,
	"to_name" varchar(200),
	"subject" varchar(200),
	"body" text NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dedupe_key" varchar(120),
	"ref_type" varchar(30),
	"ref_id" integer,
	"party_id" integer,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key" ON "notifications" USING btree ("firm_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "notifications_firm_created_idx" ON "notifications" USING btree ("firm_id","created_at");