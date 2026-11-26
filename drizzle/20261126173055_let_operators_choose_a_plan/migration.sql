ALTER TABLE "provider_accounts" ADD COLUMN "plan_choice" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "plans" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "allows_no_plan" boolean DEFAULT false NOT NULL;