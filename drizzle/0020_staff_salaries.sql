CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"firm_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(30),
	"role" varchar(80),
	"location_id" integer,
	"monthly_salary_paise" bigint DEFAULT 0 NOT NULL,
	"joined_on" date,
	"left_on" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_adjustments" (
	"employee_id" integer NOT NULL,
	"month" varchar(7) NOT NULL,
	"extra_paise" bigint DEFAULT 0 NOT NULL,
	"deduction_paise" bigint DEFAULT 0 NOT NULL,
	"note" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_adjustments_employee_id_month_pk" PRIMARY KEY("employee_id","month")
);
--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "employee_id" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "pay_month" varchar(7);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "pay_kind" varchar(10);--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_firm_idx" ON "employees" USING btree ("firm_id");--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vouchers_employee_idx" ON "vouchers" USING btree ("employee_id","pay_month");--> statement-breakpoint
-- The built-in Accountant role handles payroll along with the rest of the books. Billing staff don't see salaries.
UPDATE "roles" SET "permissions" = "permissions" || '["staff.manage"]'::jsonb WHERE "name" = 'Accountant' AND "is_system" AND NOT ("permissions" ? 'staff.manage');
