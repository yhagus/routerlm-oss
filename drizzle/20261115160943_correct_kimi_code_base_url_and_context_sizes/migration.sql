-- The Catalog's Kimi Code entry moved to api.kimi.com and to the context sizes
-- Kimi serves on every plan. The seeder never changes existing Providers, so
-- an install that already has Kimi Code is corrected here. Each field changes
-- only where it still holds the old Catalog value: an operator's edit is kept.
UPDATE "providers" SET "base_url" = 'https://api.kimi.com/coding/v1' WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true AND "base_url" = 'https://api.kimi.ai/coding/v1';
--> statement-breakpoint
UPDATE "upstream_models" SET "context_size" = 262144 WHERE "upstream_model_id" IN ('k3.1-pro', 'k3') AND "context_size" = 1048576 AND "provider_id" IN (SELECT "id" FROM "providers" WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true);
