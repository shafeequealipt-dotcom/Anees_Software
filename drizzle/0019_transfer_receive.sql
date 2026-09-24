ALTER TABLE "voucher_lines" ADD COLUMN "received_qty_milli" bigint;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD COLUMN "damaged_qty_milli" bigint;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "received_by" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Every existing firm gets one "In transit" and one "Damaged goods" location (system-managed: never
-- offered as a shop to bill from, never shown to the owner to rename/hide, nobody is assigned to
-- them). Skips a firm that somehow already has one (e.g. re-running against a fresh dev database
-- that went through insertCompany after this migration was written).
INSERT INTO "locations" ("firm_id", "name", "kind", "sort")
	SELECT f."id", 'In transit', 'transit', 900 FROM "firms" f
	WHERE NOT EXISTS (SELECT 1 FROM "locations" l WHERE l."firm_id" = f."id" AND l."kind" = 'transit');
--> statement-breakpoint
INSERT INTO "locations" ("firm_id", "name", "kind", "sort")
	SELECT f."id", 'Damaged goods', 'damaged', 901 FROM "firms" f
	WHERE NOT EXISTS (SELECT 1 FROM "locations" l WHERE l."firm_id" = f."id" AND l."kind" = 'damaged');
--> statement-breakpoint

-- Every stock transfer made before this feature existed moved stock straight to its destination
-- (the old instant-transfer behaviour), so it's retroactively "fully received, nothing damaged" —
-- otherwise it would show up as stuck in transit forever with no one able to receive it.
UPDATE "vouchers" SET "received_at" = "created_at", "received_by" = "created_by"
	WHERE "type" = 'stock_transfer' AND "received_at" IS NULL;
--> statement-breakpoint
UPDATE "voucher_lines" vl SET "received_qty_milli" = vl."qty_milli", "damaged_qty_milli" = 0
	FROM "vouchers" v
	WHERE v."id" = vl."voucher_id" AND v."type" = 'stock_transfer' AND vl."received_qty_milli" IS NULL;
