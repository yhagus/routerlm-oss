# A Provider has one endpoint per Model Kind, each with its own Protocol and base URL

Status: accepted, supersedes ADR 0016

ADR 0016 let a Provider add one image Protocol at the same base URL as its chat Protocol. Alibaba Model Studio serves chat at `{host}/compatible-mode/v1` but images, video, speech and transcription only on its native API at `{host}/api/v1`, with the same key. We decided that a Provider has a list of endpoints, at most one per Model Kind, each naming a Protocol and a base URL, and that one Provider Account serves every endpoint of its Provider.

## Considered options

- Keep one base URL and let native Protocols derive `/api/v1` by stripping `/compatible-mode/v1`: breaks as soon as an operator points the Provider at a per-workspace host or a proxy.
- A separate "Alibaba Model Studio Media" Provider: every key is entered twice, and both Providers' Cooldowns and Fallback treat one credential as two.

## Consequences

- OpenAI and OpenAI Codex become a chat endpoint plus an image endpoint at the same base URL; nothing they do changes.
- Each endpoint's base URL goes through the same URL checks as a Provider's base URL (ADR 0019).
- ADR 0003 still holds: a Provider Account belongs to exactly one Provider, now meaning one credential for one host, not one base URL.
- The seeder never adds an endpoint to an existing Provider, so an endpoint the operator deleted stays deleted, and it skips the Catalog Upstream Models of a Kind the Provider has no endpoint for. When the Catalog gives an existing Provider a new endpoint, a one-time migration adds it, as `give_alibaba_its_media_endpoints` did for Alibaba Model Studio's image, speech, transcription and video endpoints.
