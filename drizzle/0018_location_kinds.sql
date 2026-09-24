-- Adding an enum value must commit on its own: Postgres won't let a later statement in the same
-- transaction use a value just added by ALTER TYPE. The rest of this feature (columns, seeding the
-- new locations, backfilling existing transfers) is in the next migration.
ALTER TYPE "public"."location_kind" ADD VALUE 'transit';--> statement-breakpoint
ALTER TYPE "public"."location_kind" ADD VALUE 'damaged';
