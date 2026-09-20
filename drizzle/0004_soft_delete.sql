ALTER TYPE "public"."voucher_status" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "deleted_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;