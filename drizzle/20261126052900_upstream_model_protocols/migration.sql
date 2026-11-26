ALTER TABLE "upstream_models" ADD COLUMN "protocols" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "error_captures" ADD COLUMN "upstream_protocol" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "upstream_protocol" text;