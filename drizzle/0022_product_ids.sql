-- Every product gets a Product ID (items.code): never blank, unique within its company ignoring
-- upper/lower case. This runs when the app starts, so each step leaves the data ready for the next
-- and nothing here can fail on real data.

-- 1. A code that is only spaces is no code.
UPDATE "items" SET "code" = NULL WHERE "code" IS NOT NULL AND btrim("code") = '';
--> statement-breakpoint

-- 2. Two products in one company whose IDs differ only by case ("ab-1" / "AB-1") would break the
--    new rule: the later one keeps its ID with its own row number added, so nothing is lost.
UPDATE "items" i SET "code" = left(i."code", 48) || '-' || i."id"
	FROM (SELECT "id", row_number() OVER (PARTITION BY "firm_id", lower("code") ORDER BY "id") AS rn FROM "items" WHERE "code" IS NOT NULL) d
	WHERE d."id" = i."id" AND d.rn > 1;
--> statement-breakpoint

-- 3. Products with no ID get the next numbers after their company's highest numeric ID. Only IDs
--    of 1-9 digits count as part of the sequence (a 13-digit barcode typed as an ID does not).
WITH mx AS (
	SELECT f."id" AS firm_id, COALESCE(MAX(CASE WHEN i."code" ~ '^[0-9]{1,9}$' THEN i."code"::int END), 0) AS m
	FROM "firms" f LEFT JOIN "items" i ON i."firm_id" = f."id" GROUP BY f."id"
), todo AS (
	SELECT "id", "firm_id", row_number() OVER (PARTITION BY "firm_id" ORDER BY "id") AS rn FROM "items" WHERE "code" IS NULL
)
UPDATE "items" i SET "code" = (mx.m + todo.rn)::text
	FROM todo JOIN mx ON mx.firm_id = todo."firm_id"
	WHERE i."id" = todo."id";
--> statement-breakpoint

CREATE UNIQUE INDEX "items_code_lower_key" ON "items" USING btree ("firm_id",lower("code"));--> statement-breakpoint
DROP INDEX "items_code_key";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "code" SET NOT NULL;
