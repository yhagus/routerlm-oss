ALTER TABLE "api_keys" ADD COLUMN "concurrency_limit" integer;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "concurrency_limit" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "slot_wait_ms" integer DEFAULT 0 NOT NULL;