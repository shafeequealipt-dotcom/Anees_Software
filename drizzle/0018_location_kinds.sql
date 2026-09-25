-- Postgres won't let a value just added via ALTER TYPE ... ADD VALUE be used later in the same
-- transaction, and drizzle's migrator always runs every pending migration in one transaction — so
-- ADD VALUE here would break the next migration's use of 'transit'/'damaged'. Swapping in a new
-- enum type (which already has all four values) avoids that restriction entirely.
ALTER TABLE "locations" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."location_kind__new" AS ENUM('warehouse', 'shop', 'transit', 'damaged');--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "kind" TYPE "public"."location_kind__new" USING "kind"::text::"public"."location_kind__new";--> statement-breakpoint
DROP TYPE "public"."location_kind";--> statement-breakpoint
ALTER TYPE "public"."location_kind__new" RENAME TO "location_kind";--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "kind" SET DEFAULT 'shop';
