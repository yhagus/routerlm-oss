CREATE TABLE "quota_meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider_account_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"used" numeric,
	"limit" numeric,
	"remaining_percent" numeric,
	"is_unlimited" boolean DEFAULT false NOT NULL,
	"window_seconds" integer,
	"resets_at" timestamp with time zone,
	"scope" text,
	"observed_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "quota_meters_provider_account_id_key_unique" UNIQUE("provider_account_id","key")
);
--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "continue_when_exhausted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "quota_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "quota_error" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "quota_reader" text;--> statement-breakpoint
ALTER TABLE "quota_meters" ADD CONSTRAINT "quota_meters_provider_account_id_provider_accounts_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
-- The seeder never changes existing Providers, so a MiniMax M Plan seeded
-- before quota readers existed gets its reader here.
UPDATE "providers" SET "quota_reader" = 'minimax-m-plan' WHERE "slug" = 'minimax-m-plan' AND "is_from_catalog" = true AND "quota_reader" IS NULL;
