ALTER TABLE "telegram_config" ALTER COLUMN "text_model" SET DEFAULT 'nvidia/nemotron-3-super-120b-a12b:free,xingchen-agi/xing4.0-29b-a4b:free,liquid/lfm-2.5-2.6b:free';
--> statement-breakpoint
UPDATE "telegram_config" SET "text_model" = replace("text_model", 'nvidia/nemotron-3-super-120b:free', 'nvidia/nemotron-3-super-120b-a12b:free') WHERE "text_model" LIKE '%nvidia/nemotron-3-super-120b:free%';
