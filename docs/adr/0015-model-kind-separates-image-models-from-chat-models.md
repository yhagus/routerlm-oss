---
status: accepted
areas: [routing, upstream]
---
# Model Kind separates image models from chat models

Status: accepted, superseded in part by ADR 0026: there are now five Model Kinds, `chat`, `image`, `speech`, `transcription` and `video`, each with its own client endpoints, and a Provider serves each Kind through its own endpoint. The rule that a Model's Routes share one Kind and each client endpoint accepts only its Kind holds for all five.

Image generation models (such as `gpt-image-2`) cannot serve a chat request, and chat models cannot serve an image request. We decided that every Upstream Model has a Model Kind, `chat` or `image`, that all Routes of a Model point at Upstream Models of one Kind, and that each client endpoint accepts only Models of its Kind. Clients ask for images through the OpenAI Images API (`/v1/images/generations` and `/v1/images/edits`).

## Considered options

- An `image-generation` Capability: a Capability is something a request may need and only narrows Routes, so it cannot stop a chat request from reaching an image model without inventing a `text` Capability that every chat request needs.
- The Responses `image_generation` tool on `/v1/responses`: it is not a function tool, and editing across turns relies on `previous_response_id` or replayed image items, which ADR 0002 rules out. OpenAI Codex itself calls the Images API, not this tool.

## Consequences

- The Responses `image_generation` tool stays unsupported and keeps its 400.
- Image responses are returned as `b64_json` only and never stored (ADR 0004); there is no `url` response format.
- In v1 image requests do not stream; `stream: true` gets a 400 naming the feature.
