-- Every Catalog Provider now ships Verified, unless its catalog file opts out
-- (the two Tencent TokenHub files do, so they are left out here). The seeder
-- never changes existing Providers, so an install marks its Catalog Providers
-- Verified here, once, on the day their catalog file was checked. A Provider
-- already Verified keeps its date, and one an operator created stays as it is.
UPDATE "providers"
SET "verified" = true, "verified_at" = "checked"."retrieved_on"
FROM (VALUES
  ('alibaba-model-studio-intl', '2026-11-15T00:00:00Z'::timestamptz),
  ('alibaba-token-plan', '2026-11-23T00:00:00Z'::timestamptz),
  ('anthropic', '2026-11-15T00:00:00Z'::timestamptz),
  ('clinepass', '2026-11-22T00:00:00Z'::timestamptz),
  ('commandcode', '2026-11-17T00:00:00Z'::timestamptz),
  ('deepseek', '2026-11-15T00:00:00Z'::timestamptz),
  ('google-gemini', '2026-11-18T00:00:00Z'::timestamptz),
  ('kimi-code', '2026-11-15T00:00:00Z'::timestamptz),
  ('meta-ai', '2026-11-18T00:00:00Z'::timestamptz),
  ('minimax-api', '2026-11-15T00:00:00Z'::timestamptz),
  ('minimax-m-plan', '2026-11-15T00:00:00Z'::timestamptz),
  ('moonshot', '2026-11-15T00:00:00Z'::timestamptz),
  ('openai-codex', '2026-11-16T00:00:00Z'::timestamptz),
  ('openai', '2026-11-15T00:00:00Z'::timestamptz),
  ('opencode-go', '2026-11-17T00:00:00Z'::timestamptz),
  ('tokenharbor', '2026-11-26T00:00:00Z'::timestamptz),
  ('tokenrouter-com', '2026-11-26T00:00:00Z'::timestamptz),
  ('tokenrouter-io', '2026-11-26T00:00:00Z'::timestamptz),
  ('xiaomi-mimo-token-plan', '2026-11-18T00:00:00Z'::timestamptz),
  ('xiaomi-mimo', '2026-11-15T00:00:00Z'::timestamptz),
  ('zai-coding-plan', '2026-11-22T00:00:00Z'::timestamptz),
  ('zai', '2026-11-22T00:00:00Z'::timestamptz)
) AS "checked" ("slug", "retrieved_on")
WHERE "providers"."slug" = "checked"."slug"
  AND "providers"."is_from_catalog" = true
  AND "providers"."verified" = false;
