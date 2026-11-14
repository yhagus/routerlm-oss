CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"key_id" text NOT NULL UNIQUE,
	"hash" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"allowed_model_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"mfa" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_last_four" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_style" text NOT NULL,
	"quirks" jsonb DEFAULT '{}' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_from_catalog" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upstream_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider_id" uuid NOT NULL,
	"upstream_model_id" text NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"context_size" integer NOT NULL,
	"max_output_tokens" integer,
	"input_price" numeric(12,6),
	"output_price" numeric(12,6),
	"cache_read_price" numeric(12,6),
	"cache_write_price" numeric(12,6),
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_models_provider_id_upstream_model_id_unique" UNIQUE("provider_id","upstream_model_id")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"parameter_policy" jsonb DEFAULT '{}' NOT NULL,
	"has_automatic_cache_breakpoints" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"model_id" uuid NOT NULL,
	"upstream_model_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"parameter_policy_override" jsonb,
	"connect_timeout_ms" integer,
	"first_token_timeout_ms" integer,
	"total_timeout_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usage_log_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"route_id" uuid,
	"provider_account_id" uuid,
	"upstream_status" integer,
	"failure_reason" text,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"usage_log_id" uuid NOT NULL,
	"attempt_id" uuid,
	"request_headers" jsonb NOT NULL,
	"request_body" text NOT NULL,
	"response_headers" jsonb,
	"response_body" text
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone NOT NULL,
	"api_key_id" uuid,
	"user_id" uuid,
	"is_playground" boolean DEFAULT false NOT NULL,
	"model_id" uuid,
	"route_id" uuid,
	"provider_account_id" uuid,
	"client_protocol" text NOT NULL,
	"is_streamed" boolean NOT NULL,
	"http_status" integer NOT NULL,
	"error_code" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"reasoning_tokens" integer,
	"request_bytes" integer NOT NULL,
	"response_bytes" integer NOT NULL,
	"cost" numeric(18,10),
	"time_to_first_token_ms" integer,
	"duration_ms" integer NOT NULL,
	"attempt_count" integer NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"is_incomplete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_accounts_provider_id_priority_idx" ON "provider_accounts" ("provider_id","priority");--> statement-breakpoint
CREATE INDEX "routes_model_id_priority_idx" ON "routes" ("model_id","priority");--> statement-breakpoint
CREATE INDEX "attempts_usage_log_id_idx" ON "attempts" ("usage_log_id");--> statement-breakpoint
CREATE INDEX "error_captures_created_at_idx" ON "error_captures" ("created_at");--> statement-breakpoint
CREATE INDEX "error_captures_usage_log_id_idx" ON "error_captures" ("usage_log_id");--> statement-breakpoint
CREATE INDEX "usage_logs_created_at_idx" ON "usage_logs" ("created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_api_key_id_created_at_idx" ON "usage_logs" ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_model_id_created_at_idx" ON "usage_logs" ("model_id","created_at");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_users_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_users_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_provider_id_providers_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD CONSTRAINT "upstream_models_provider_id_providers_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_model_id_models_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_upstream_model_id_upstream_models_id_fkey" FOREIGN KEY ("upstream_model_id") REFERENCES "upstream_models"("id");--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_usage_log_id_usage_logs_id_fkey" FOREIGN KEY ("usage_log_id") REFERENCES "usage_logs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_route_id_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_provider_account_id_provider_accounts_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "error_captures" ADD CONSTRAINT "error_captures_usage_log_id_usage_logs_id_fkey" FOREIGN KEY ("usage_log_id") REFERENCES "usage_logs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "error_captures" ADD CONSTRAINT "error_captures_attempt_id_attempts_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_api_key_id_api_keys_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_model_id_models_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_route_id_routes_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_provider_account_id_provider_accounts_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_accounts"("id") ON DELETE SET NULL;