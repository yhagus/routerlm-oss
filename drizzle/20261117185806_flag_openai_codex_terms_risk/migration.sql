-- OpenAI Codex ships flagged in the Catalog from now on. The seeder never changes
-- existing Providers, so an install that already has it gets the flag here.
UPDATE "providers" SET "terms_risk" = true WHERE "slug" = 'openai-codex';
