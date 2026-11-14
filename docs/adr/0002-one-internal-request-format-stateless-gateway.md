# Translate every request through one internal format and keep the gateway stateless

Clients can call the gateway in three Protocols (OpenAI Chat Completions, Anthropic Messages, OpenAI Responses) and Providers speak two (OpenAI Chat Completions, Anthropic Messages), and Fallback may move one request between Providers that speak different Protocols. We decided that every request is converted into one internal format on the way in and converted again for the upstream, so each Protocol needs one converter per direction, not one per pair. The gateway keeps no conversation state: clients send the full conversation on every request.

## Considered Options

- Pass each client Protocol straight to a Provider speaking the same Protocol. Rejected: a Model could then only have Routes of one Protocol, which defeats Fallback across Providers.
- Pairwise converters between Protocols. Rejected: the count grows with every Protocol added.

## Consequences

- Only what the internal format can express survives translation. In v1 that is text, image input, streaming, function tools, reasoning, and structured output. A request that needs anything else gets a 400 that names the feature.
- Stateful Responses features (`store`, `previous_response_id`, stored conversations) are rejected with a 400. Supporting them would mean storing prompts and responses, which ADR 0004 forbids.
- Request fields the gateway doesn't know are dropped without an error, because passing them through breaks when Fallback changes Protocol.
- Adding a client or upstream Protocol means writing one converter and touching nothing else.
