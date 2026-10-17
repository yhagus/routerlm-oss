# Grok CLI Quota Family

## Status

Draft

## Context

Grok CLI free tier has multiple independent quota pools, one per model family (grok-4.6, grok-4.7, etc). Each family has a 1M token rolling 24-hour window. Effort variants within a family (grok-4.6-high, grok-4.6-low) share the same pool. The grok-4.5 family shares the grok-4.6 pool.

Exhaustion is error-driven: upstream returns 429 `subscription:free-usage-exhausted` or 402 `personal-team-blocked:spending-limit`. The error text includes `for model grok-X.Y` and a confirmed `tokens (actual/limit)` pair.

The previous design locked the entire account on any exhaustion, preventing all models from being served. The new design locks only the exhausted family, allowing other families to continue serving requests.

## Decision

### Unit: family

A family is a major version `grok-X.Y`. Effort variants share the family pool.

| Model | Family |
|---|---|
| `grok-4.6`, `grok-4.6-low`, `grok-4.6-high` | `grok-4.6` |
| `grok-4.5*`, `grok-build` | `grok-4.6` (shared) |
| `grok-4.7*` | `grok-4.7` |
| `grok-4.8-high` | `grok-4.8` (auto) |
| `grok-code-fast-1` | own id |

One hardcoded alias: 4.5 / `grok-build` → 4.6. All others parse `grok-X.Y`.

### Switching: account-only, model stays

Request `grok-4.6-high` exhausted on account A → skip A for family `grok-4.6`. Same request tries account B. Account A still serves `grok-4.7` requests.

When all accounts exhaust family 4.6, return error. Never change the model.

### Cooldown: 24 hours from exhaustion

`resetAt = exhaustedAt + 24h`. After `resetAt`, family is available again. No 30-minute cap. No gRPC reset timestamp.

### Storage

```json
{
  "grokCliFreeUsageByFamily": {
    "grok-4.6": {
      "exhausted": true,
      "used": 564079,
      "limit": 1000000,
      "resetAt": "<exhaustedAt + 24h>",
      "exhaustedAt": "<now>"
    }
  }
}
```

Legacy `grokCliFreeUsageExhausted` marker maps to family `grok-4.6`.

### Module

`backend/src/services/providers/grokCliQuotaFamily.ts` is the single source of truth. Callers go through its interface.

### Callers

- `selectChatConnection` + `mediaFallbackLoop`: skip account only for the request's family.
- `markAccountUnavailable`: write family from error text, fallback to model.
- `clearAccountError`: success clears only the request's family.
- `clearConnectionLocks`: clears all families.
- Probe: ping each family whose `resetAt` has passed, using `{family}-low`.
- Executor: do not record free-usage-exhausted in QuotaTracker (family module owns it).
- Dashboard: per-family bars (`Grok 4.6`, `Grok 4.7`), not `Daily Allowance`.

## Consequences

- Multiple families per account can be active simultaneously.
- Account switching happens within the same model family.
- Cooldown is deterministic: 24 hours from exhaustion time.
- Per-family token limits are 1M each.
- Legacy markers are backward-compatible.
