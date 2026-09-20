ALTER TABLE "vouchers" ADD COLUMN "tcs_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "tcs_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "tds_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "tds_paise" bigint DEFAULT 0 NOT NULL;