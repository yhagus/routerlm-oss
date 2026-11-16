ALTER TABLE "provider_accounts" ADD COLUMN "oauth_encrypted_id_token" text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_account_id" text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_email" text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_plan_type" text;--> statement-breakpoint
-- OAuth Login data is now keyed by its flow (ADR 0013). Every Provider that
-- offered it so far signs in the way Kimi Code does.
UPDATE "providers" SET "oauth_login" = jsonb_build_object('flow', 'kimi-code') || "oauth_login" WHERE "oauth_login" IS NOT NULL AND NOT ("oauth_login" ? 'flow');--> statement-breakpoint
-- The Catalog's OpenAI Codex entry now offers its OAuth Login. The seeder
-- never changes existing Providers, so an install that already has it gets
-- it here, unless an operator set it already.
UPDATE "providers" SET "oauth_login" = '{"flow":"openai-codex","issuer":"https://auth.openai.com","clientId":"app_EMoamEEZ73f0CkXaXp7hrann","cliVersion":"0.169.0"}'::jsonb WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true AND "oauth_login" IS NULL;
