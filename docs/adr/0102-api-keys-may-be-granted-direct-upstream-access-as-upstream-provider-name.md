---
status: accepted
areas: [api-keys, routing, inference, integrations, control-plane]
---
# API Keys may be granted Direct Upstream Access as `upstream/<provider>/<name>`

An API Key has a Direct Upstream Access flag, off by default. With it on, the key can call any usable Upstream Model by sending `upstream/<provider slug>/<upstream model name>`, and `/v1/models` lists every such Upstream Model in that form after the key's Models, with `owned_by` set to the provider slug. Usable means an enabled Provider with at least one enabled Provider Account, an enabled Upstream Model, and no Terms Risk while that Setting is off. The request is served like a Direct Upstream Model test: Fallback across the Provider's enabled Provider Accounts with Plan Coverage applied, a Capabilities and Model Kind check, conversion from any client Protocol, no Parameter Policy, and a Usage Log with no Model or Route whose `requested_model_name` holds the exact string. The key's Spend Limit and Request Rate still apply.

The flag is independent of the allowed Models and Model Groups (ADR 0063): it adds the upstream names on top and never widens or narrows the Model lists, so an empty list still means every Model and never every Upstream Model. We kept it separate because "every Model" is the default for an unrestricted key, and reaching every Provider directly is a much wider grant that an operator should choose explicitly.

An Integration has the same flag. Its Customer keys can get Direct Upstream Access through the control plane only when the Integration has it, just as their Models must fall inside the Integration's.

Resolution tries an exact Model name, then the `upstream/` prefix, then a Model Group slug (ADR 0101). `upstream` is reserved and can never be a Model Group's slug. The name splits on its first two `/` only, so an Upstream Model name that contains `/`, as resellers use, stays whole. Every refusal, whether the key lacks the flag, the slug or name is unknown, or the Upstream Model isn't usable right now, is the same "model not found", so a key without access learns nothing about the gateway's Providers.

## Consequences

Clients hard-code these strings, so renaming a Provider slug or an Upstream Model breaks them. A key with the flag bypasses every Route, so Model-level Parameter Policy and Caps don't protect those requests. The dashboard marks such keys with a badge.
