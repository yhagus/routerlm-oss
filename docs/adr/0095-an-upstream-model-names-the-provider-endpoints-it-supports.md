# An Upstream Model names the Provider Endpoints it supports

Status: accepted, supersedes ADR 0026

TokenRouter.com sells every model behind one key, but serves Claude only on Anthropic Messages, its newest GPT models only on OpenAI Responses, and the rest on OpenAI chat completions. ADR 0016 rejected several Protocols per Provider because "nothing needs more than one Protocol per Kind", and ADR 0026 kept one endpoint per Model Kind, so the only fit was three Providers with the same key: the duplicated credential that ADR 0026 itself rejected for Alibaba. We decided (2026-11-26) that a Provider has at most one Provider Endpoint per Protocol, any number per Model Kind, and that each Upstream Model lists, in order, the Protocols of the Provider Endpoints it supports. An empty list means the Provider's first Provider Endpoint of the model's Kind, so every existing Provider and Upstream Model keeps working unchanged.

## Considered options

- One Provider per endpoint (what shipped first for TokenRouter.com): one credential becomes several Provider Accounts, with split Cooldowns and Fallback, and an operator rotates the same key in each.
- A Protocol and base URL on every Upstream Model: repeats the address on every model and moves URL checks (ADR 0019) off the Provider.
- Referring to endpoints by id: no Provider needs one Protocol at two addresses, and Protocol names are what the Catalog and the API already speak.

## Consequences

- An Attempt goes out on the client's Protocol when the Upstream Model lists it, which keeps the request byte-stable (ADR 0043) and reasoning signatures valid (ADR 0045); otherwise on the model's first listed Protocol. The choice is made once per Attempt: a failure goes to the usual Fallback (ADR 0049), never to the same account's other Provider Endpoint.
- A Probe uses the model's first listed Provider Endpoint, so it still gives one result per Provider Account.
- Provider quirks and service tiers stay on the Provider and apply only to Attempts sent through their own Protocol.
- Deleting a Provider Endpoint is refused while any Upstream Model lists it.
- Usage Logs and Error Captures record the upstream Protocol of the Attempt, since the Provider alone no longer tells which wire format a request went out on.
- The seeder sets an Upstream Model's list only when it creates the model. An empty list is a choice (the default endpoint), not a missing value, so the ADR 0003 rule for filling empty values does not apply.
