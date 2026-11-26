---
status: accepted
areas: [inference, usage]
---
# Token counts are what the upstream reported; a missing count is null and flags the Usage Log

A Usage Log needs token counts, but Providers report different subsets. We decided the gateway never estimates a count: `TokenUsage` fields are null when the upstream did not report them, which flags the Usage Log incomplete. `inputTokens` excludes cached input, so the input total is `inputTokens + cacheReadTokens + cacheWriteTokens`.

Cache reads are part of Chat Completions (`cached_tokens`), so a missing one is unreported. Cache writes are not: only Providers with explicit caching add a count and the others bill nothing for writes, so a usage object without one means zero writes. The Responses upstream converter does the same, since that Protocol has no cache writes to bill.

## Consequences

- Cost for an incomplete Usage Log is a lower bound, never a guess.
