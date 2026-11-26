-- Terms Risk now flags only Providers the gateway uses by posing as their own client
-- (ADR 0099), so these seven ship unflagged from now on. The seeder never changes
-- existing Providers, so an install that already has them is unflagged here.
UPDATE "providers" SET "terms_risk" = false
WHERE "is_from_catalog" = true
  AND "slug" IN (
    'alibaba-token-plan',
    'clinepass',
    'meta-ai',
    'minimax-m-plan',
    'tokenrouter-com',
    'xiaomi-mimo-token-plan',
    'zai-coding-plan'
  );
