-- The Catalog's Kimi Code entry now offers OAuth Login (ADR 0012): the auth
-- host of each region, and the client id and version of the official Kimi
-- Code CLI. The seeder never changes existing Providers, so an install that
-- already has Kimi Code gets them here, unless an operator set them already.
UPDATE "providers" SET "oauth_login" = '{"authHosts":{"global":"https://auth.kimi.ai","china":"https://auth.kimi.com"},"clientId":"17e5f671-d194-4dfb-9706-5516cb48c098","cliVersion":"2.6.2"}'::jsonb WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true AND "oauth_login" IS NULL;
