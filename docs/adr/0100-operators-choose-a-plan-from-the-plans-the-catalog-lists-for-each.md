---
status: accepted
areas: [catalog, plans, upstream, web]
---
# Operators choose a Plan from the Plans the Catalog lists for each Provider

ADR 0097 decided that a Provider Account's Plan is read from the Provider and never typed by an operator. That leaves an operator with no say when the Plan cannot be read: only TokenHarbor and OpenAI Codex report one, a reader can fail or return a stale value, and Kimi Code, MiniMax M Plan, Z.ai Coding Plan, Alibaba Token Plan, Xiaomi MiMo Token Plan and OpenCode Go sell tiers no reader sees. We decided that each Provider that sells several Plans lists them in the Catalog, and that every Provider Account of such a Provider has a Plan Choice: Auto (the default), which keeps ADR 0097's reading, or one of the listed Plans, which takes precedence over what the reader reports. The reader keeps running under a chosen Plan, so the dashboard shows both and a stale choice is easy to spot. A listed Plan's value is the exact string its reader reports (Codex's `chatgpt_plan_type`, such as `prolite`, shown as "Pro"; TokenHarbor's `plan_name`), and its display name where no reader exists. None (pays per token) is offered only where the Provider also charges per token, which today is TokenHarbor. A value a reader returns that the list lacks is kept as it is. The rest of ADR 0097 stands: Plan Coverage is still read live and never shipped in the Catalog.

## Considered Options

- Free text, as ADR 0097 rejected: a typed Plan that matches no coverage entry silently restricts routing.
- Deriving the choices from the Plan Coverage stored on Upstream Models: only TokenHarbor reports coverage, so Codex and the readerless Providers would have no choices.
- Listing every Plan a Provider knows, such as Codex's 19 workspace variants: the select would be mostly enterprise and education tiers one operator never holds; Auto still carries them when a reader returns them.
