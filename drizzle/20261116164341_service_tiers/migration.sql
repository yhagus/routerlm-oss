ALTER TABLE "providers" ADD COLUMN "service_tier_values" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "service_tiers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "tier_prices" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "service_tier" text;