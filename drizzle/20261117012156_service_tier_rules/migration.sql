-- Service Tier rules (ADR 0014): a Provider's tier values need a Protocol that
-- sends a tier, and an Upstream Model prices only tiers it lists. v2.1.0
-- stored rows that break them, though none had any effect: the gateway drops a
-- tier on a Protocol that never sends one, and never reads a price of an
-- unlisted tier. They are cleared first so the constraints can be added.
UPDATE "upstream_models" SET "service_tiers" = '{}'::text[], "tier_prices" = '{}'::jsonb FROM "providers" WHERE "upstream_models"."provider_id" = "providers"."id" AND "providers"."protocol" NOT IN ('openai-chat', 'openai-responses') AND ("upstream_models"."service_tiers" <> '{}'::text[] OR "upstream_models"."tier_prices" <> '{}'::jsonb);
--> statement-breakpoint
UPDATE "providers" SET "service_tier_values" = '{}'::jsonb WHERE "protocol" NOT IN ('openai-chat', 'openai-responses') AND "service_tier_values" <> '{}'::jsonb;
--> statement-breakpoint
UPDATE "upstream_models" SET "tier_prices" = (SELECT COALESCE(jsonb_object_agg("price"."key", "price"."value"), '{}'::jsonb) FROM jsonb_each("upstream_models"."tier_prices") AS "price" WHERE "price"."key" = ANY("upstream_models"."service_tiers")) WHERE ("tier_prices" - "service_tiers") <> '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_service_tier_values_protocol_check" CHECK ("service_tier_values" = '{}'::jsonb
      or "protocol" in ('openai-chat', 'openai-responses'));--> statement-breakpoint
ALTER TABLE "upstream_models" ADD CONSTRAINT "upstream_models_tier_prices_listed_check" CHECK (("tier_prices" - "service_tiers") = '{}'::jsonb);