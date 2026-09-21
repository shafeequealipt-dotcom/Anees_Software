CREATE TABLE "firm_images" (
	"firm_id" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"mime" varchar(30) NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firm_images_firm_id_kind_pk" PRIMARY KEY("firm_id","kind")
);
--> statement-breakpoint
ALTER TABLE "firm_images" ADD CONSTRAINT "firm_images_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;