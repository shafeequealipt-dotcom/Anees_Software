ALTER TABLE "firms" ALTER COLUMN "state_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "country" varchar(2) DEFAULT 'IN' NOT NULL;