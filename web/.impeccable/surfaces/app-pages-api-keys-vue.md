---
version: 1
slug: "app-pages-api-keys-vue"
primary_target: "app/pages/api-keys.vue"
related_targets: ["app/app.vue","app/pages/providers.vue","app/pages/routing.vue","app/pages/usage.vue"]
---

# API Key Management

## Job and audience
Platform operators manage credentials used to access the RouterLM gateway and verify whether those credentials remain safe and active.

## Outcome and proof
Operators can create, label, scope, rotate, revoke, and inspect API key usage without exposing secrets. Proof is key status, scope, owner or label, creation date, last-used date, and clear one-time reveal behavior.

## Selected direction
Inherit the RouterLM operations console shell. Use a clear key inventory with a deliberate create/rotate flow and a focused detail or usage view.

## Scope and boundaries
Include key inventory, create, scope/permission selection, one-time reveal/copy, rotation, revoke, status, and last-used metadata. Do not invent an organization or billing permissions model.

## States and ranges
Active, expiring, revoked, never used, creating, created, reveal-once, copy success, rotation pending, rotation success/failure, revoke confirmation, validation error, empty inventory, and permission denied. Handle many keys and long labels safely.

## Interaction and layout
The create flow explains the secret reveal boundary before submission. Sensitive values remain masked after the one-time reveal. Rotation and revoke are explicit, consequence-aware actions with local feedback. Desktop uses a dense inventory with detail affordances; tablet stacks filters and detail content while preserving key status.
