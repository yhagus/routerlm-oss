---
version: 1
slug: "app-pages-routing-vue"
primary_target: "app/pages/routing.vue"
related_targets: ["app/app.vue","app/pages/providers.vue","app/pages/usage.vue","app/pages/api-keys.vue"]
---

# Routing Overview

## Job and audience
Platform operators monitor current gateway health and decide where to investigate or intervene first.

## Outcome and proof
Operators can answer whether traffic is healthy, which providers and routes are carrying it, and where latency, errors, or fallbacks require attention. Proof is current request volume, provider distribution, latency, error rate, fallback activity, cache behavior, and recent routing events.

## Selected direction
Inherit the RouterLM operations console shell. Make the overview a high-signal operational landing view that moves from system health to provider/route detail to recent events.

## Scope and boundaries
Include health summary, route/provider distribution, latency and error signals, fallback activity, cache signals, recent routing events, time range, and drill-through links. Do not invent alerting policy or unsupported SLO claims.

## States and ranges
Healthy, degraded, no traffic, partial telemetry, stale data, loading, permission denied, and query failure. Support high-volume traffic, multiple routes, provider/model names, and outlier values.

## Interaction and layout
Lead with the most actionable health signals, then show distribution and trends, then recent events. Filters and time range remain visible. Charts have exact-value access and link to usage, provider, or request detail. Tablet stacks trend panels and preserves the health summary above the fold.
