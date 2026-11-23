CREATE TABLE "usage_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider_account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "usage_resets_provider_account_id_external_id_unique" UNIQUE("provider_account_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "usage_resets" ADD CONSTRAINT "usage_resets_provider_account_id_provider_accounts_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_accounts"("id") ON DELETE CASCADE;