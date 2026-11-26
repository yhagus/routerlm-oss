---
status: accepted
areas: [settings, libs]
---
# Private upstreams are allowed by a Setting, not an env variable

Status: accepted, supersedes the env variable in ADR 0019

ADR 0019 makes Provider URLs https and public, and checks them when they are written and again when the gateway connects. One deploy-time env variable, `ALLOW_PRIVATE_UPSTREAMS`, lifted both rules for self-hosters with a LAN upstream such as Ollama or vLLM. Changing it meant editing the deployment and restarting it. We decided that a boolean Setting, "Allow private upstreams" (default off), lifts both rules instead, and that the env variable is removed with no fallback, as ADR 0017 did for the Retention Period.

The checks that use the setting (module-constant URL schemas, `OutboundFetch`) are synchronous and cannot read the database, so each successful snapshot reload publishes the value to `src/libs/models/private-upstreams-policy.ts` (ADR 0020). It starts off, so a process that has not read it yet refuses private upstreams, and a failed reload keeps the last value read.

## Considered options

- Keep the env variable, as ADR 0019 decided. Rejected: operators wanted to change it from the dashboard while the gateway runs.
- Keep the env variable as a ceiling, with a Setting that works only when the env allows it. Rejected: two sources of truth, which ADR 0017 also rejected.

## Consequences

- A hijacked dashboard session can turn the Setting on. It can then aim a Provider Account's credential at a private host and read internal services through the gateway. ADR 0019 kept the env variable to prevent exactly this. Every User is an equal operator, so protect dashboard sessions accordingly.
- The two checks in ADR 0019 stay. Only the switch that lifts them moves.
- The checks run synchronously, so each process reads the Setting from its snapshot. A change takes effect at the next snapshot reload, within `SNAPSHOT_RELOAD_INTERVAL_MS`. Before a process first reads the Setting, the checks treat it as off. A failed reload keeps the last value, like the rest of the snapshot, so a database outage does not cut off a working LAN upstream.
- Instances that set `ALLOW_PRIVATE_UPSTREAMS=true` fall back to off when they upgrade, and their LAN upstreams are refused until a User turns the Setting on. The CHANGELOG records the break.
