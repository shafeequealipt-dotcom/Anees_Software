-- Custom roles can now belong to one company (its owners manage them; other companies never see them).
-- Built-in roles, and roles the Owner shares with every company, keep an empty firm_id.
ALTER TABLE "roles" DROP CONSTRAINT "roles_name_unique";--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "firm_id" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- A custom role whose people all work in one and the same company becomes that company's role.
-- Unused custom roles, and ones used across companies, stay shared (the Owner can move them).
UPDATE "roles" r SET "firm_id" = x."firm_id"
	FROM (
		SELECT u."role_id", min(uf."firm_id") AS "firm_id"
		FROM "users" u JOIN "user_firms" uf ON uf."user_id" = u."id"
		GROUP BY u."role_id"
		HAVING count(DISTINCT uf."firm_id") = 1
	) x
	WHERE r."id" = x."role_id" AND NOT r."is_system" AND NOT r."is_owner";--> statement-breakpoint

-- Company owners can now manage their companies' roles.
UPDATE "roles" SET "permissions" = "permissions" || '["roles.manage"]'::jsonb
	WHERE lower("name") = 'company owner' AND "is_system" AND NOT ("permissions" ? 'roles.manage');--> statement-breakpoint

-- Its description said it couldn't change roles; now it can, for its own companies.
UPDATE "roles" SET "description" = 'Full control of the companies ticked for them, and nothing outside them. Can add users and roles for those companies; cannot add companies or change shared roles.'
	WHERE lower("name") = 'company owner' AND "is_system" AND "description" = 'Full control of the companies ticked for them, and nothing outside them. Cannot add companies or change roles.';--> statement-breakpoint

CREATE UNIQUE INDEX "roles_name_firm_key" ON "roles" USING btree (coalesce("firm_id", 0),lower("name"));
