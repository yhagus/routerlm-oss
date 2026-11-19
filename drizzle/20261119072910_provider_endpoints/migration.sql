-- ADR 0026: a Provider's one Protocol and base URL become its chat endpoint.
ALTER TABLE "providers" DROP CONSTRAINT "providers_service_tier_values_protocol_check";--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "endpoints" jsonb;--> statement-breakpoint
UPDATE "providers" SET "endpoints" = jsonb_build_array(
  jsonb_build_object('kind', 'chat', 'protocol', "protocol", 'baseUrl', "base_url")
);--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "endpoints" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "protocol";--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "base_url";--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_service_tier_values_protocol_check" CHECK ("service_tier_values" = '{}'::jsonb
      or "endpoints" @> '[{"kind":"chat","protocol":"openai-chat"}]'::jsonb or "endpoints" @> '[{"kind":"chat","protocol":"openai-responses"}]'::jsonb);
