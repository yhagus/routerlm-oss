---
version: 1
slug: "app-pages-providers-index-vue"
primary_target: "app/pages/providers/index.vue"
related_targets: ["app/pages/providers/[id].vue","app/app.vue","app/pages/routing.vue","app/pages/usage.vue","app/pages/api-keys.vue"]
---

# Provider Management

## Job and audience
Platform operators configure and maintain the model providers available to the RouterLM gateway.

## Outcome and proof
Operators can see which providers are available, verify connection health, understand supported models, update configuration, and run a safe connectivity test. Proof is provider status, model coverage, last check time, and test result.

## Selected direction
Inherit the RouterLM operations console shell. Structure the page around a provider inventory with clear status and a focused provider detail workflow.

## Scope and boundaries
Production-ready management view with provider list, search/filter, connection status, model support, configuration, enable/disable, and test actions. Do not invent provider capabilities or pricing.

## States and ranges
Healthy, degraded, disconnected, disabled, missing credentials, testing, test success, test failure, empty inventory, permission denied, validation errors, and unsaved changes. Support many providers and long model lists.

## Interaction and layout
Inventory rows or cards expose status and the next useful action. Detail views group connection settings, supported models, and test controls. Sensitive values are masked. Changes require explicit save feedback; destructive disable or removal actions confirm impact. Desktop uses split list/detail when space allows; tablet stacks the detail view.
