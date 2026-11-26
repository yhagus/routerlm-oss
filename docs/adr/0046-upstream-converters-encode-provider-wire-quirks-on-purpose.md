---
status: accepted
areas: [inference]
---
# Upstream converters encode Provider wire quirks on purpose

Several constants and branches in the upstream converters look arbitrary and are Provider requirements. We decided to keep them, and not to "normalise" them:

- `anthropic-messages-upstream-converter.ts` pins the `anthropic-version` that every Anthropic-compatible Provider accepts; later versions refuse sampling parameters (`temperature`, `top_p`) on every model.
- A thinking budget goes as a fixed budget because the models that take one refuse effort levels; an effort level turns on adaptive thinking with a readable summary, since the default display returns empty thinking text.
- `openai-chat-upstream-converter.ts` writes `REASONING_PLACEHOLDER` (a single space) as `reasoning_content` when a turn must carry reasoning but has none, because some Providers reject an empty one.
- For a Provider that takes a `thinking` object, thinking stays enabled whatever the client asked: those models cannot turn it off.
- `openai-responses-upstream-converter.ts` writes `strict` on every function tool, with `DEFAULT_TOOL_STRICTNESS` false, because the Responses default is strict while Chat Completions and Anthropic are not, and a tool the client did not mark must keep their meaning.

## Consequences

- Adding a Provider with different behaviour is done through its quirks data (ADR 0003), not by changing these constants.
