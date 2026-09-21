CREATE TABLE "backup_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requested_by" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"message" text
);
--> statement-breakpoint
ALTER TABLE "backup_requests" ADD CONSTRAINT "backup_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;