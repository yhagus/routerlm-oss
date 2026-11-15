-- The Catalog's Kimi Code entry gained the quirks its inference needs:
-- reasoning as a `thinking` object, `max_completion_tokens`, the client's
-- `prompt_cache_key`, `reasoning_content` in history and the error that means
-- Exhausted. The seeder never changes existing Providers, so an install that
-- already has Kimi Code gets them here, unless an operator edited its quirks.
UPDATE "providers" SET "quirks" = '{"reasoningContentInHistory":"tool-call-turns","reasoningAsThinking":{"efforts":{"none":"low","minimal":"low","low":"low","medium":"high","high":"high","xhigh":"max"},"upstreamModelsWithoutEffort":["kimi-for-coding-highspeed"]},"forwardsClientPromptCacheKey":true,"usesMaxCompletionTokens":true,"exhaustedErrorCodes":["exceeded_current_quota_error"]}'::jsonb WHERE "slug" = 'kimi-code' AND "is_from_catalog" = true AND "quirks" = '{}'::jsonb;
