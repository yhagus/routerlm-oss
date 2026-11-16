-- The Catalog's OpenAI Codex entry now names a quota reader, and the error
-- type with which Codex refuses a used-up plan. The seeder never changes
-- existing Providers, so an install that already has OpenAI Codex gets them
-- here, unless an operator already set a reader or Exhausted error codes.
UPDATE "providers" SET "quota_reader" = 'openai-codex' WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true AND "quota_reader" IS NULL;
--> statement-breakpoint
UPDATE "providers" SET "quirks" = "quirks" || '{"exhaustedErrorCodes":["usage_limit_reached"]}'::jsonb WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true AND NOT ("quirks" ? 'exhaustedErrorCodes');
