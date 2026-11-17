-- The Catalog now gives each Upstream Model the most context and output its
-- Provider accepts, not a default: Kimi K3 models output up to 1,048,576
-- tokens, OpenAI Codex models take their max_context_window, and so on; where
-- the docs are silent the figures are models.dev's. The
-- seeder never changes existing rows, so an install seeded before is raised
-- here. Each value changes only where it still holds the old Catalog value:
-- an operator's edit is kept.
UPDATE "upstream_models" SET "max_output_tokens" = 1048576 WHERE "upstream_model_id" = 'kimi-k3.1-pro' AND "max_output_tokens" = 131072 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'moonshot' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 1048576 WHERE "upstream_model_id" = 'kimi-k3.1-pro-highspeed' AND "max_output_tokens" = 131072 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'moonshot' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 1048576 WHERE "upstream_model_id" = 'kimi-k3' AND "max_output_tokens" = 131072 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'moonshot' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 1048576 WHERE "upstream_model_id" = 'k3.1-pro' AND "context_size" = 262144 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 1048576 WHERE "upstream_model_id" = 'k3.1-pro' AND "max_output_tokens" = 131072 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 1048576 WHERE "upstream_model_id" = 'k3.1-pro-highspeed' AND "max_output_tokens" = 131072 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 1048576 WHERE "upstream_model_id" = 'k3' AND "context_size" = 262144 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 1048576 WHERE "upstream_model_id" = 'k3' AND "max_output_tokens" = 131072 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 262144 WHERE "upstream_model_id" = 'k3-256k' AND "max_output_tokens" = 131072 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-6-astra' AND "context_size" = 500000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-6.1-sol' AND "context_size" = 500000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-6.1-terra' AND "context_size" = 500000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-6-sol' AND "context_size" = 272000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-6-luna' AND "context_size" = 272000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-5.6-sol' AND "context_size" = 272000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-5.6-terra' AND "context_size" = 272000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 872000 WHERE "upstream_model_id" = 'gpt-5.6-luna' AND "context_size" = 272000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'openai-codex' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 1000000 WHERE "upstream_model_id" = 'MiniMax-M3.1-Flash' AND "context_size" = 524288 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'minimax-m-plan' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 1000000 WHERE "upstream_model_id" = 'MiniMax-M3' AND "context_size" = 524288 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'minimax-m-plan' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 1048576 WHERE "upstream_model_id" = 'glm-5.2' AND "context_size" = 1000000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'alibaba-model-studio-intl' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 393216 WHERE "upstream_model_id" = 'deepseek-flash' AND "max_output_tokens" = 384000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'deepseek' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "max_output_tokens" = 393216 WHERE "upstream_model_id" = 'deepseek-v4-pro' AND "max_output_tokens" = 384000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'deepseek' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 1048576 WHERE "upstream_model_id" = 'deepseek-flash' AND "context_size" = 1000000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'deepseek' AND "is_from_catalog" = true);
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 1048576 WHERE "upstream_model_id" = 'deepseek-v4-pro' AND "context_size" = 1000000 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'deepseek' AND "is_from_catalog" = true);
