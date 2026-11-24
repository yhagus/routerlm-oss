# A Provider Account is Exhausted from its unscoped Quota Meters, set when a reading is made

Routing never reads Quota Meters (ADR 0010). Whether a Provider Account is Exhausted is decided when a quota reading is applied (`applyExhausted` in `src/quota-meters/commands/handlers/read-provider-account-quota.handler.ts`, `exhaustedStateOf` in `src/quota-meters/models/exhausted.ts`) and written to the Provider Account, which routing then skips until the meter resets.

We decided that only unscoped meters count: a scoped one such as `weekly:video` covers what the gateway doesn't serve. The Kimi Code reader makes every meter unscoped because any one limit running out stops the whole plan. A reading of an account the operator lets keep serving while Exhausted does not set the state, but an Exhausted state set by a refused Attempt still runs its course. A failed reading changes nothing.
