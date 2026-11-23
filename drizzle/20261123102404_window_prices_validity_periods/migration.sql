ALTER TABLE "upstream_model_pricing_windows" ADD COLUMN "valid_from" timestamp;--> statement-breakpoint
ALTER TABLE "upstream_model_pricing_windows" ADD COLUMN "valid_until" timestamp;--> statement-breakpoint
ALTER TABLE "upstream_model_pricing_windows" ADD CONSTRAINT "upstream_model_pricing_windows_validity_check" CHECK ("valid_from" < "valid_until");