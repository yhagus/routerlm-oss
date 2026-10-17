# Probe 407 (Grok CLI healthy / damaged)

Probe 407 is **not** an HTTP 407 check. It is a live chat quality test.

Some Grok CLI accounts still authenticate and return HTTP 200, but the model no longer follows instructions. Billing and quota APIs do not detect this. Probe 407 sends a fixed prompt and classifies the account from the reply text.

`407` and `202` are **test codes only**. They are not HTTP status codes. They are not proxy errors.

## What the test measures

| Account | Observed behavior |
|---|---|
| Healthy | Follows the instruction. Reply contains `407`. |
| Damaged | Ignores the instruction. Often replies `202`, or other unexpected text. |

## Test contract

Keep these values identical in every implementation. A different prompt or model produces incomparable results.

1. Provider: `grok-cli` (OAuth, `cli-chat-proxy` plane).
2. Model: `grok-4.6` (quota family `grok-4.6`).
3. Prompt, exact string: `Reply exactly with '407'`
4. Transport: OpenAI Responses API, streaming (`stream: true`).
5. Cap: `max_output_tokens: 16`
6. Do not persist: `store: false`
7. One account per request. Do not run parallel probes on the same account.

Request body:

```json
{
  "model": "grok-4.6",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": "Reply exactly with '407'"
    }
  ],
  "max_output_tokens": 16,
  "stream": true,
  "store": false
}
```

Refresh the OAuth token first if it is near expiry. Use the same proxy as a normal chat request for that account. Send the same Grok CLI headers as chat (`x-grok-client-*`, plus `X-XAI-Token-Auth` on the proxy plane).

## How to read the reply

Do not use raw `response.text()`. Collect text from the SSE stream:

- `response.output_text.delta` → append `delta`
- `response.completed` → append `response.output[].content[].text`

Trim the concatenated string. That value is `reply`.

## Classification (strict order)

Apply the first matching rule:

1. HTTP is not OK, or the probe throws → `error`
2. `reply` matches `/407/` **and** does not match `/202/` → `healthy`
3. `reply` matches `/202/` → `damaged`
4. Anything else (empty, `"ok"`, unrelated text) → `damaged` with `"Unexpected reply."`

The regex is a **substring** match, not an exact match. `"407."` is healthy. `"202"` in the middle of a sentence is damaged.

If the reply contains **both** `407` and `202`, it is **not** healthy. Rule 2 fails. Rule 3 marks it damaged.

| Status | Meaning | Side effect |
|---|---|---|
| `healthy` | The model followed the instruction. | Clear account error markers. |
| `damaged` | The model did not follow the instruction. | Mark the account unavailable for `grok-4.6` with reason `probe-407:damaged`. |
| `error` | The test itself failed (auth, proxy, timeout). | Do **not** lock the account. The test is invalid. |

`error` is not `damaged`. Do not mix them.

## Job orchestration

Do not block the HTTP request until every account finishes.

1. `POST` accepts `connectionIds[]`, creates a job, and returns `{ jobId, status, result }` immediately.
2. The worker runs **serially**: finish account 1, then start account 2.
3. Each item moves `queued` → `probing` → `healthy` \| `damaged` \| `error`.
4. Clients poll `GET` by `jobId`.
5. Counters `total`, `completed`, `healthy`, `damaged`, `errors` come from the item list.

Serial execution avoids Grok rate limits and session-header collisions.

## What not to do

- Do not treat HTTP 407 or HTTP 202 as the test result.
- Do not use billing, gRPC credits, or the `"ping"` availability probe. Those are different tests.
- Do not change the prompt (`"say 407"`, `"407 only"`). Damaged models are sensitive to wording.
- Do not raise `max_output_tokens` by a large amount. This test needs a short reply.
- Do not lock an account on `error`.
- Do not treat `damaged` as quota exhaustion. Quota exhaustion is usually HTTP 429/402 plus `subscription:free-usage-exhausted`.

## Port checklist

1. Auth and headers match a normal Grok CLI chat request.
2. Call `/responses` with streaming and parse SSE deltas.
3. Apply the four classification rules in the same order.
4. Healthy → clear the account. Damaged → isolate that model/family. Error → no-op.
5. Show the raw `reply` in the UI. The text is evidence, not only a badge.

## One-line summary

Send the fixed prompt `Reply exactly with '407'` to `grok-4.6`. If the reply contains `407` and not `202`, the account is healthy. If it contains `202` or does not follow the instruction, the account is damaged even when HTTP is 200.
