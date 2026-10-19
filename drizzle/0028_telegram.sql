CREATE TABLE "telegram_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"bot_token_enc" text,
	"bot_username" varchar(64),
	"webhook_secret_hash" varchar(64),
	"ai_key_enc" text,
	"bot_token_hint" varchar(8),
	"ai_key_hint" varchar(8),
	"model" varchar(100) DEFAULT 'anthropic/claude-sonnet-5-5' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"chat_id" bigint NOT NULL,
	"source_key" varchar(80) NOT NULL,
	"sent_by" integer,
	"summary_message_id" integer,
	"status" varchar(12) DEFAULT 'reading' NOT NULL,
	"extracted" jsonb,
	"entries" jsonb,
	"check" jsonb,
	"notes" text,
	"error" text,
	"voucher_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"message_id" integer NOT NULL,
	"file_id" varchar(200) NOT NULL,
	"mime" varchar(60) NOT NULL,
	"data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"code_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"firm_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"chat_id" bigint NOT NULL,
	"telegram_name" varchar(120),
	"firm_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_config" ADD CONSTRAINT "telegram_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_drafts" ADD CONSTRAINT "telegram_drafts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_drafts" ADD CONSTRAINT "telegram_drafts_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_drafts" ADD CONSTRAINT "telegram_drafts_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_files" ADD CONSTRAINT "telegram_files_draft_id_telegram_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."telegram_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_drafts_source_key" ON "telegram_drafts" USING btree ("chat_id","source_key");--> statement-breakpoint
CREATE INDEX "telegram_drafts_voucher_idx" ON "telegram_drafts" USING btree ("voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_files_message_key" ON "telegram_files" USING btree ("draft_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_chat_key" ON "telegram_links" USING btree ("chat_id");