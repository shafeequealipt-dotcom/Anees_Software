CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"description" varchar(300),
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "roles" ("name", "description", "permissions", "is_owner", "is_system") VALUES
	('Owner', 'Full access to everything, including users, roles and settings.', '[]'::jsonb, true, true),
	('Accountant', 'Sees money, reports and all prices. Cannot manage users or settings.', '["vouchers.create","vouchers.edit","vouchers.editOld","vouchers.cancel","masters.edit","masters.delete","money.view","money.edit","reports.sales","reports.all","see.purchasePrice","see.partyBalance","see.partyContact","see.stockValue"]'::jsonb, false, true),
	('Billing staff', 'Creates bills and parties. Cannot see purchase prices, cash & bank or profit reports.', '["vouchers.create","vouchers.edit","masters.edit","reports.sales","see.partyBalance","see.partyContact"]'::jsonb, false, true);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" integer;--> statement-breakpoint
UPDATE "users" SET "role_id" = (SELECT "id" FROM "roles" WHERE "name" = CASE "users"."role"::text WHEN 'owner' THEN 'Owner' WHEN 'accountant' THEN 'Accountant' ELSE 'Billing staff' END);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."user_role";
