---
status: accepted
areas: [inference]
---
# Reasoning crosses Protocols only with the signature its own Protocol issued

Reasoning travels through the internal format (ADR 0002) as text with an optional `signature`. Anthropic Messages accepts thinking back in a later turn only with the signature it issued, and OpenAI Responses only with the encrypted content it issued; Chat Completions has nowhere to carry either.

We decided that reasoning from a Protocol without signatures is written to an Anthropic Messages client with an empty signature, and that `anthropic-messages-client-converter.ts` drops an empty signature again when the client sends it back, since it proves nothing. Going upstream, `anthropic-messages-upstream-converter.ts` and `openai-responses-upstream-converter.ts` leave out reasoning that has no signature (or no encrypted content), because it came from another Protocol and the upstream would refuse it. In the Responses client converter the model's raw thinking goes in `content` as reasoning text, not in `summary`, and a signature travels as `encrypted_content`, which clients send back with the item.

## Consequences

- After Fallback changes Protocol, the next turn loses the earlier reasoning rather than failing.
