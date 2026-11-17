# Service Tiers are gateway names mapped per Provider, and dropped where unsupported

OpenAI Codex has a fast mode (`service_tier: "priority"`) and a flex mode, the OpenAI API has the same field with the same values, and other Providers have nothing like it or something unrelated under the same name (Anthropic's `auto`/`standard_only`). We decided that a Service Tier is a gateway-owned name (`fast`, `flex`) that clients and Parameter Policies use, that each Provider's data maps those names to its wire values, and that each Upstream Model lists the tiers it accepts. A client's tier is honoured unless the Parameter Policy forces or forbids one. When the Route's Upstream Model does not accept the tier, it is dropped for that Attempt without an error, and Fallback does not skip the Route.

## Considered options

- Treat the tier as a Capability that filters Routes: a tier is a speed preference, and a request that cannot run fast should still run.
- Pass the client's raw `service_tier` through: ADR 0002 drops unknown fields because Fallback can change Protocol and Provider, and the raw values mean different things at different Providers.
- A per-Provider-Account "always fast" switch: the operator already controls defaults through Parameter Policy, so a Model such as `gpt-6-sol-fast` can force it.

## Consequences

- When no tier is set, no tier is sent, so the Provider's own default applies, even where that default is priority.
- OpenAI's raw `priority` and Codex's legacy `fast` both read as `fast`; `default` and `auto` mean no tier. Anthropic's `service_tier` is ignored.
- Service Tier values are allowed only on a Provider whose Protocol writes `service_tier` (`openai-chat` and `openai-responses`). Anthropic Messages never sends one, so a database check refuses tier values there. Any other Provider on those two Protocols may have them, because Providers are data (ADR 0003); the Catalog gives them to OpenAI and OpenAI Codex only.
- An Upstream Model lists only tiers its Provider maps, and prices only tiers it lists. The API refuses a write that breaks the first rule, naming the tiers, and a Provider edit that would unmap a tier a model lists. A database check enforces the second rule, because it needs only one row. The Catalog loader applies both.
- The Usage Log records the tier that served the request, and Cost uses the Upstream Model's price for that tier when it has one, falling back to the standard price.
