ALTER TABLE "provider_accounts" RENAME COLUMN "oauth_plan_type" TO "plan";--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "plan_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "pays_beyond_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "plan_coverage" text[];--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "plan_coverage_checked_at" timestamp with time zone;