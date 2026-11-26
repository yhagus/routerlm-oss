---
status: superseded
superseded-by: 0026
areas: [upstream, catalog]
---
# A Provider has an optional image Protocol beside its chat Protocol

Status: superseded by ADR 0026

ADR 0003 gives each Provider one Protocol, but OpenAI serves chat on `openai-chat` and images on the Images API, and OpenAI Codex serves chat on `openai-responses` and images on the same Images API shape (`{base}/images/generations` and `{base}/images/edits` under `chatgpt.com/backend-api/codex`), with the same credential. We decided that a Provider keeps its chat Protocol and gains an optional image Protocol (`openai-images`) at the same base URL, so one Provider Account and one OAuth Login serve both Kinds.

## Considered options

- Separate image Providers ("OpenAI Images", "OpenAI Codex Images"): every credential and OAuth Login would be added twice, and Codex quota, which is per plan, would be split across two Providers.
- A list of Protocols on the Provider: nothing needs more than one Protocol per Kind, and a list would leave unclear which one a chat request uses.

## Consequences

- An image Upstream Model can exist only on a Provider that has an image Protocol.
- Any operator-added Provider that speaks the OpenAI Images API can serve images with no deploy.
