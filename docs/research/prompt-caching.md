# Prompt caching per Provider

Research date: 2026-11-15, for ticket #18 (spec #2, "Cache behavior"). Sources are each Provider's own documentation. It decides the caching quirks in `src/catalog/providers/*.json`: `acceptsPromptCacheKey` and `acceptsCacheControl` (openai-chat) and `cacheMarkerLimit` (anthropic-messages).

The Catalog seeder never updates existing rows, so an install seeded before this change gets these quirks only through an edit on the Providers page.

## Summary

| Provider | Protocol | Caching | Marker limit | Min size | Prompt cache key | Quirks set |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI | openai-chat | Automatic; explicit `prompt_cache_breakpoint` on GPT-5.6+ | 4 | 1,024 tokens | Yes, `prompt_cache_key` on Chat Completions | `acceptsPromptCacheKey` |
| Anthropic | anthropic-messages | Explicit `cache_control`, or top-level automatic | 4 | 512 to 4,096 tokens by model | No | none (default limit 4) |
| DeepSeek | openai-chat | Automatic (disk) | n/a | Not stated | No (`user_id` isolates the cache) | none |
| Alibaba Model Studio intl | openai-chat | Implicit, or explicit `cache_control` | 4 | 1,024 tokens | Not documented | `acceptsCacheControl` (already set) |
| Moonshot | openai-chat | Automatic | n/a (explicit breakpoints refused) | Not stated | Unconfirmed | none |
| Kimi Code | openai-chat | Not documented | n/a | n/a | Not documented | none |
| MiniMax | anthropic-messages | Automatic prefix matching | `cache_control` not documented | 512 tokens | No | `cacheMarkerLimit: 0` |
| Xiaomi MiMo | openai-chat | Cache-hit prices exist; mechanism not readable | Unknown | Unknown | Unknown | none |

## OpenAI

- Automatic by default; on GPT-5.6 and later an explicit mode takes `prompt_cache_breakpoint: { mode: "explicit", ttl? }` on content parts, up to four per request (implicit mode uses one slot). No `cache_control`.
- Minimum 1,024 visible input tokens on GPT-5.6+; earlier models vary with tools, images, schema and reasoning effort.
- Chat Completions accepts `prompt_cache_key` ("Used by OpenAI to cache responses for similar requests to optimize your cache hit rates. Replaces the `user` field."). Before GPT-5.6 it steers cache routing; from GPT-5.6 it is optional and separates cache accounting.
- TTL: 30 minutes on GPT-5.6+ (`prompt_cache_options.ttl` accepts only `"30m"` on Chat Completions); earlier models use `prompt_cache_retention` (`in_memory` or `24h`).
- Sources: [Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching), [Chat Completions create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Anthropic

- Up to four `cache_control` breakpoints per request; top-level automatic caching uses one of them, and a fifth is a 400.
- Minimum cacheable length: 512 tokens (Haiku 5.5, Opus 5.5, Opus 5, Sonnet 5.5, Fable 5, Mythos 5), 1,024 (Sonnet 5, Sonnet 4.6, Opus 4.8), 2,048 (Opus 4.7), 4,096 (Opus 4.6, Opus 4.5, Haiku 4.5). Shorter prompts are processed uncached without an error.
- The cache lookup checks up to 20 blocks back from each breakpoint, which is why the gateway also marks the end of the tools and of the system prompt, not only the latest turn.
- Markable: tools, system text, message text, images, documents, `tool_use` and `tool_result` blocks. Not markable: thinking blocks and empty text blocks.
- TTL `5m` (default) or `1h`.
- Source: [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

## DeepSeek

- "Context Caching on Disk Technology is enabled by default for all users." No minimum size and no fixed TTL ("usually within a few hours to a few days").
- No `prompt_cache_key` and no `cache_control`; `user_id` "can be used for KVCache isolation for privacy management".
- Sources: [KV cache guide](https://api-docs.deepseek.com/guides/kv_cache), [Create chat completion](https://api-docs.deepseek.com/api/create-chat-completion).

## Alibaba Cloud Model Studio (international)

- Implicit caching is always on for supported models; explicit caching is opt-in and the two are mutually exclusive per request.
- Explicit: `"cache_control": {"type": "ephemeral"}` on content parts of system, user, assistant and tool messages (content must be an array). "A single request supports up to four cache markers." Minimum 1,024 tokens, TTL 5 minutes reset on a hit, 20-block lookback.
- No `prompt_cache_key` or session id documented.
- The openai-chat converter does not write `cache_control` yet, so `acceptsCacheControl` currently has no effect (follow-up).
- Source: [Context cache](https://www.alibabacloud.com/help/en/model-studio/context-cache).

## Moonshot (Kimi API)

- "The Kimi API automatically enables context caching for repeated request prefixes." Optional `prompt_cache_options: {"mode": "implicit", "ttl": "5m" | "1h"}`; a `prompt_cache_breakpoint` in content is refused with a 400.
- `prompt_cache_key` is not in the readable text of the Chat API reference or the caching guide, so the quirk stays off.
- Sources: [Chat API](https://platform.kimi.ai/docs/api/chat), [Context caching](https://platform.kimi.ai/docs/guide/context-caching.md), [Chat pricing](https://platform.kimi.ai/docs/pricing/chat.md) (platform.moonshot.ai redirects there).

## Kimi Code

- No caching, `prompt_cache_key` or `cache_control` documentation found.
- Sources: [Kimi Code docs](https://www.kimi.com/coding/docs/en/), [Claude Code setup](https://www.kimi.com/coding/docs/en/third-party-tools/claude-code.html).

## MiniMax

- Caching is automatic prefix matching for 512 or more input tokens (MiniMax-M3, MiniMax-M3.1-Flash). The Anthropic-compatible parameter table does not list `cache_control`, and the caching page's Anthropic example sends none.
- Whether the endpoint ignores or refuses `cache_control` is not documented, so `cacheMarkerLimit: 0` keeps the gateway from adding markers there. Markers a client sets are still sent unchanged.
- Sources: [Anthropic-compatible API](https://platform.minimax.io/docs/api-reference/text-anthropic-api), [Prompt caching](https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache).

## Xiaomi MiMo

- The docs are client-rendered and could not be read. The home page lists "Input (cache hit)" and "Input (cache miss)" prices, so some caching exists; its mechanism, size and any key are unknown. No quirks set.
- Sources: [MiMo home](https://mimo.mi.com), [API platform](https://platform.xiaomimimo.com/#/docs) (shell only).
