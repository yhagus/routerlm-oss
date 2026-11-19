ALTER TABLE "upstream_models" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "price_per_image" numeric(14,8);--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "price_per_image_by_size" jsonb;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "price_per_input_image" numeric(14,8);--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "price_per_second_by_resolution" jsonb;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "price_per_million_characters" numeric(14,8);--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "price_per_audio_second" numeric(14,8);--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "max_input_images" integer;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "min_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "max_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "resolutions" text[];--> statement-breakpoint
ALTER TABLE "upstream_models" ADD COLUMN "sizes" text[];--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "images_out" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "images_in" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "output_seconds" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "audio_seconds" numeric(12,3);--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "characters" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "unit_tier" text;