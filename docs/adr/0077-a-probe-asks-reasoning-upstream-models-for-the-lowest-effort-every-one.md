---
status: accepted
areas: [playground]
---
# A Probe asks reasoning Upstream Models for the lowest effort every one of them accepts

A Probe sends a fixed minimal request for the Upstream Model's Kind (GLOSSARY "Probe"). Reasoning models differ in what they accept: some refuse `none`, others `minimal` too (see the Catalog notes).

We decided the chat Probe sends `reasoning_effort: "low"` (`CHAT_REASONING_EFFORT` in `src/playground/models/probe-requests.ts`), the lowest effort all reasoning Upstream Models accept. A Provider that takes reasoning as a `thinking` object gets its own name for it from its quirk. The token cap is small (16); a reasoning model may spend all of it and answer empty, which still counts as a success.

## Consequences

- Lowering the effort to `none` or `minimal` makes Probes of some models fail for the wrong reason.
