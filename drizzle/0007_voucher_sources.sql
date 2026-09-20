CREATE TABLE "voucher_sources" (
	"voucher_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	CONSTRAINT "voucher_sources_voucher_id_source_id_pk" PRIMARY KEY("voucher_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "voucher_sources" ADD CONSTRAINT "voucher_sources_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_sources" ADD CONSTRAINT "voucher_sources_source_id_vouchers_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voucher_sources_source_idx" ON "voucher_sources" USING btree ("source_id");