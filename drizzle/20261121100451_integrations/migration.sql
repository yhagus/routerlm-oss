CREATE TABLE "integration_rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"integration_id" uuid NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by_id" uuid,
	"previous_key_id" text NOT NULL,
	"new_key_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"key_id" text NOT NULL UNIQUE,
	"hash" text NOT NULL,
	"allowed_model_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "integration_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "spend_limit" numeric(18,10);--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "spent" numeric(18,10) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "request_rate" integer;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "integration_name" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "integration_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "integration_name" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "usage_logs_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "api_keys_integration_id_customer_id_idx" ON "api_keys" ("integration_id","customer_id");--> statement-breakpoint
CREATE INDEX "integration_rotations_integration_id_rotated_at_idx" ON "integration_rotations" ("integration_id","rotated_at");--> statement-breakpoint
CREATE INDEX "usage_logs_integration_id_sequence_idx" ON "usage_logs" ("integration_id","sequence");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_integration_id_integrations_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "integration_rotations" ADD CONSTRAINT "integration_rotations_integration_id_integrations_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_rotations" ADD CONSTRAINT "integration_rotations_rotated_by_id_users_id_fkey" FOREIGN KEY ("rotated_by_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_id_users_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;