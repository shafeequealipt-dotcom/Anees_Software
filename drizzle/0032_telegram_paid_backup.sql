ALTER TABLE "telegram_config" ALTER COLUMN "model" SET DEFAULT 'google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,google/gemini-2.5-flash-lite';
--> statement-breakpoint
UPDATE "telegram_config" SET "model" = 'google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,google/gemini-2.5-flash-lite' WHERE "model" = 'google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,minimax/minimax-m3.1-flash:free';
