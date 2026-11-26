---
status: accepted
areas: [catalog, upstream, inference]
---
# Plan Coverage is read live from the Provider, not shipped in the Catalog

A TokenHarbor Provider Account on a Plan with no wallet funds is refused with HTTP 402 `model_not_in_plan` for Upstream Models its Plan does not cover. TokenHarbor's pricing and subscription pages disagree about which models each Pass covers, and its API docs say coverage "can change over time... so read it from the listing rather than storing it". We decided that Plan Coverage is live data on each Upstream Model, refreshed by a per-Provider coverage reader (for TokenHarbor, `covered_by_plans` on `GET /v1/models`) hourly, when a Provider Account is added and on demand, and never written by the Catalog seed. A Provider Account's Plan is likewise read by a per-Provider reader (TokenHarbor's `GET /api/cli/free-tier`, Codex's id_token) into one Provider-neutral column, never typed by an operator.

Routing skips a Provider Account whose Plan is missing from an Upstream Model's coverage list, unless an operator lets that account pay per token beyond its Plan, since the wallet balance cannot be read. Unknown coverage (`null`, or a Provider with no coverage reader) means unrestricted, and a `model_not_in_plan` refusal falls back to the next Provider Account without starting a Cooldown, so a wrong or stale coverage list costs one Attempt rather than a failed request.

## Considered Options

- Shipping each Plan's model list in the Catalog JSON: stale on the day it ships, and the two TokenHarbor pages it would be copied from already disagree.
- A `plan_type` field the operator fills in the Provider Account form: TokenHarbor reports the Plan itself, and a Plan name alone says nothing about which models it covers.
- Learning coverage only from 402 refusals per Provider Account and Upstream Model: every first call to an uncovered model would waste an Attempt, and the refusal code is observed, not documented.
