-- The Catalog's Kimi Code entry now names a quota reader. The seeder never
-- changes existing Providers, so an install that already has Kimi Code gets
-- the reader here, unless an operator gave the Provider one already.
UPDATE "providers" SET "quota_reader" = 'kimi-code' WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true AND "quota_reader" IS NULL;
