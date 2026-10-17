# Public key status page (`/`)

## Goal

The root path `/` renders a public status page. The page shows usage for one
gateway API key. The key comes from the `?apikey=` query parameter. The page
needs no dashboard session.

## Data source

New public backend route: `GET /api/public/stats?apikey=<key>`.

- The route accepts `apikey` or `key` as the parameter name.
- A missing key returns 400. An unknown or inactive key returns 404.
- Possession of the key is the access control. This matches the existing
  `/api/connect` discovery route behavior.

## Response payload

- `key`: name, keyPrefix, createdAt, limitMode, limitValue, usageRequests,
  usageTokens.
- `totals`: requests, promptTokens, completionTokens, totalTokens,
  cachedTokens, cost, lastUsed.
- `combos`: combos allowed for the key. Each entry carries `contextWindow`
  and `maxOutput` from the combo capabilities when set, plus usage totals
  including `cachedTokens`. Cost is not exposed. The UI brands combos as
  "Models". Member models stay hidden.
- `activeRequests`: in-flight request count for this key.
- `endpoints`: chat completions, responses, and anthropic messages. Each
  entry carries `stream: true`.
- `recentRequests`: last 20 usage rows for the key. The UI renders two
  columns of 10.

## Backend changes

- `usageHistory.meta.comboName` is now written by the chat executor path and
  the generic gateway path. Per-combo usage was empty before this change.
- The in-flight request registry gains an API key dimension
  (`pendingByApiKey`). The per-account dimension stays unchanged.
- The route sets `Cache-Control: no-store`. The page polls every 5 seconds.

## Frontend

- Route `/` renders `HomeStatsView.vue` as a public route.
- Sections: status header, usage limit, models (combos), active requests,
  endpoints with streamable badges, authentication examples, and request logs
  in two columns.
- Each model card shows requests, tokens as in/out, and the cache rate.
  Context window and max output appear when the combo capabilities set them.
  No cost appears anywhere on the page.

## Decisions

- Any active key works, not only `visibility = "public"` keys. Possession of
  the key already grants gateway access, so it grants read-only stats too.
  Tighten to public keys only if abuse appears.
- All three chat endpoints stream SSE to the client, so each shows a
  "Streamable" badge. Verified in `services/execution/chat.ts` and
  `services/gateway.ts`.
