ALTER TABLE "attempts" DROP CONSTRAINT "attempts_route_id_routes_id_fkey";--> statement-breakpoint
ALTER TABLE "attempts" DROP CONSTRAINT "attempts_provider_account_id_provider_accounts_id_fkey";--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_api_key_id_api_keys_id_fkey";--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_user_id_users_id_fkey";--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_model_id_models_id_fkey";--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_route_id_routes_id_fkey";--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_provider_account_id_provider_accounts_id_fkey";--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "model_name" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "api_key_name" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "upstream_model_id" uuid;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "upstream_model_name" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "provider_slug" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "provider_account_name" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "api_key_name" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "model_name" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "upstream_model_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "upstream_model_name" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "provider_slug" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "provider_account_name" text;--> statement-breakpoint
CREATE INDEX "usage_logs_upstream_model_id_created_at_idx" ON "usage_logs" ("upstream_model_id","created_at");--> statement-breakpoint
-- Backfill the copied names from the configuration rows that still exist
-- (ADR 0024). A row whose link was already cleared keeps null names. The
-- Upstream Model is the Route's current one: the best guess for older rows.
UPDATE "usage_logs" SET "model_name" = "models"."name"
FROM "models" WHERE "models"."id" = "usage_logs"."model_id";
--> statement-breakpoint
UPDATE "usage_logs" SET "api_key_name" = "api_keys"."name"
FROM "api_keys" WHERE "api_keys"."id" = "usage_logs"."api_key_id";
--> statement-breakpoint
UPDATE "usage_logs" SET "provider_account_name" = "provider_accounts"."name", "provider_slug" = "providers"."slug"
FROM "provider_accounts" JOIN "providers" ON "providers"."id" = "provider_accounts"."provider_id"
WHERE "provider_accounts"."id" = "usage_logs"."provider_account_id";
--> statement-breakpoint
UPDATE "usage_logs" SET "upstream_model_id" = "upstream_models"."id", "upstream_model_name" = "upstream_models"."upstream_model_id"
FROM "routes" JOIN "upstream_models" ON "upstream_models"."id" = "routes"."upstream_model_id"
WHERE "routes"."id" = "usage_logs"."route_id";
--> statement-breakpoint
UPDATE "attempts" SET "model_name" = "usage_logs"."model_name", "api_key_name" = "usage_logs"."api_key_name"
FROM "usage_logs" WHERE "usage_logs"."id" = "attempts"."usage_log_id";
--> statement-breakpoint
UPDATE "attempts" SET "provider_account_name" = "provider_accounts"."name", "provider_slug" = "providers"."slug"
FROM "provider_accounts" JOIN "providers" ON "providers"."id" = "provider_accounts"."provider_id"
WHERE "provider_accounts"."id" = "attempts"."provider_account_id";
--> statement-breakpoint
UPDATE "attempts" SET "upstream_model_id" = "upstream_models"."id", "upstream_model_name" = "upstream_models"."upstream_model_id"
FROM "routes" JOIN "upstream_models" ON "upstream_models"."id" = "routes"."upstream_model_id"
WHERE "routes"."id" = "attempts"."route_id";
