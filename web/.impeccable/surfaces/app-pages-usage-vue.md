---
version: 1
slug: "app-pages-usage-vue"
primary_target: "app/pages/usage.vue"
related_targets: ["app/app.vue","app/pages/providers.vue","app/pages/routing.vue","app/pages/api-keys.vue"]
---

# Usage Analytics

## Job and audience
Platform operators investigate traffic patterns, model/provider consumption, performance, and cache efficiency.

## Outcome and proof
Operators can compare request volume, input/output/cached tokens, cache-hit rate, latency, errors, and provider/model usage over a selected time range. Proof is synthetic but operationally realistic data with exact values and clear units.

## Selected direction
Inherit the RouterLM operations console shell. Structure the page around a time-range query with headline metrics, trend views, and breakdown tables that support drill-through.

## Scope and boundaries
Include time-range and grouping controls, request/token/cache metrics, latency and error trends, provider/model breakdowns, and export or detail affordances only if supported by the product. Do not invent billing or cost claims.

## States and ranges
Loading, empty range, no telemetry, partial data, query error, permission denied, high-volume values, zero-cache periods, and long provider/model labels. Distinguish input, output, cached, and total tokens in every relevant view.

## Interaction and layout
Filters persist within the section and update all related views consistently. Charts expose tooltip values and accessible summaries. Tables support sorting, pagination, and row expansion or drill-through. Desktop can show parallel trends and breakdowns; tablet stacks them without losing the active query context.
