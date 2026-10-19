ALTER TABLE "telegram_config" ALTER COLUMN "model" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "telegram_config" ALTER COLUMN "model" SET DEFAULT 'google/gemma-4-31b-it:free,nvidia/nemotron-3.5-super-vl:free,minimax/minimax-m3.1-flash:free';--> statement-breakpoint
ALTER TABLE "telegram_config" ADD COLUMN "text_model" varchar(200) DEFAULT 'nvidia/nemotron-3-super-120b:free,xingchen-agi/xing4.0-29b-a4b:free,liquid/lfm-2.5-2.6b:free' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_config" ADD COLUMN "read_mode" varchar(8) DEFAULT 'ocr' NOT NULL;
--> statement-breakpoint
UPDATE "telegram_config" SET "model" = 'google/gemma-4-31b-it:free,nvidia/nemotron-3.5-super-vl:free,minimax/minimax-m3.1-flash:free' WHERE "model" = 'anthropic/claude-sonnet-5-5';
