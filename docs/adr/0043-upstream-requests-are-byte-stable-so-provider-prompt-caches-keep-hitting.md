# Upstream requests are byte-stable so Provider prompt caches keep hitting

Providers cache a prompt by its prefix, and some route requests to a cache by a key, so a request that differs by one byte from the last one of the same conversation misses the cache and costs full price (see `docs/research/prompt-caching.md` for what each Provider does).

We decided that the gateway writes the same request as the same bytes, and sends the same requests to the same cache:

- Every upstream converter writes its JSON with a fixed key order (`openai-chat-upstream-converter.ts`, `openai-responses-upstream-converter.ts`, `anthropic-messages-upstream-converter.ts`). Anthropic also accepts thinking blocks back only after an unchanged prefix. `UpstreamRequest.body` is documented as byte-identical for the same input.
- `applyParameterPolicy` in `src/inference/models/parameter-policy.ts` is pure: the same request and policy always give the same result.
- Automatic cache breakpoints (`automatic-cache-breakpoints.ts`) are added after the Parameter Policy, so the policy's system prompt counts as part of the system prompt they mark.
- The prompt cache key (`prompt-cache-key.ts`) is a hash that stays the same for every request of one owner to one destination, so a Provider that routes by it sends them to the same cache, and never sees our ids.

## Consequences

- A converter change that reorders keys, or a policy step that depends on time or randomness, silently raises every Customer's Cost.
- The gateway's own cache breakpoints are decided after the policy, never before it.
