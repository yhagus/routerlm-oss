---
status: accepted
areas: [catalog, settings]
---
# Terms Risk flags only Providers the gateway uses by posing as their own client

Terms Risk used to flag any Provider whose terms the gateway's use "may breach", which caught nine Providers, most of them because their terms limit a plan to coding tools, ban application backends or forbid offering access through a gateway. We narrowed it: a Provider that publishes its inference URL and how to call it is taken to allow use through an external tool or service such as the gateway, whatever its terms say about tools, scenarios or backends, since a Provider that documents its endpoint for third-party tools knows they will call it. Terms against sharing or reselling access do not count either: they concern how many people use the gateway, which the flag cannot see, so each Provider's notes say when sharing the gateway breaches its terms. What is left is a Provider the gateway can only use by presenting the identity of the Provider's own client, which the operator cannot avoid by how they use it: Kimi Code and OpenAI Codex, whose OAuth Logins sign in as the official CLI. Alibaba Token Plan, ClinePass, Meta AI, MiniMax M Plan, TokenRouter.com, Xiaomi MiMo Token Plan and Z.ai Coding Plan are no longer flagged, and a data migration unflags them on existing installs, since the seeder never updates a Provider it already created.

## Considered Options

- Flagging a Provider whose terms limit it to a named list of tools or ban application backends (Alibaba Token Plan, Xiaomi MiMo Token Plan, Z.ai Coding Plan): rejected, as those terms do not name gateways and the published endpoint and model listing are a stronger signal of what the Provider expects.
- A second flag for gateway and resale clauses: a new column and Setting for a distinction that depends on how many people use the gateway, which the flag cannot know.
