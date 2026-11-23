CREATE TABLE "pricing_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"time_zone" text NOT NULL,
	"ranges" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upstream_model_pricing_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"upstream_model_id" uuid NOT NULL,
	"pricing_window_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"input_price" numeric(12,6),
	"output_price" numeric(12,6),
	"cache_read_price" numeric(12,6),
	"cache_write_price" numeric(12,6),
	CONSTRAINT "upstream_model_pricing_windows_model_window_unique" UNIQUE("upstream_model_id","pricing_window_id"),
	CONSTRAINT "upstream_model_pricing_windows_model_position_unique" UNIQUE("upstream_model_id","position"),
	CONSTRAINT "upstream_model_pricing_windows_price_check" CHECK ("input_price" is not null
        or "output_price" is not null
        or "cache_read_price" is not null
        or "cache_write_price" is not null)
);
--> statement-breakpoint
ALTER TABLE "upstream_model_pricing_windows" ADD CONSTRAINT "upstream_model_pricing_windows_usUTIr9QkhL5_fkey" FOREIGN KEY ("upstream_model_id") REFERENCES "upstream_models"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "upstream_model_pricing_windows" ADD CONSTRAINT "upstream_model_pricing_windows_pJuPLWCj2Shh_fkey" FOREIGN KEY ("pricing_window_id") REFERENCES "pricing_windows"("id") ON DELETE CASCADE;