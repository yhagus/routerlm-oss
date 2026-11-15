ALTER TABLE "provider_accounts" ADD COLUMN "credential_kind" text DEFAULT 'api-key' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_encrypted_access_token" text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_encrypted_refresh_token" text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_region" text;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD COLUMN "oauth_device_id" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "oauth_login" jsonb;--> statement-breakpoint
ALTER TABLE "provider_accounts" ALTER COLUMN "encrypted_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_accounts" ALTER COLUMN "key_last_four" DROP NOT NULL;