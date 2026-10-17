# dsh

`dsh.ts` is a standalone DeepSeek Harness client. It has no dependencies.

It runs with Node 22.18 or later (`node dsh.ts`) or with Bun (`bun dsh.ts`).

## Quick start

```sh
node dsh.ts login                              # browser sign-in, saves ~/.config/dsh/auth.json
node dsh.ts chat "Explain PKCE in one line"    # one-shot, streamed
node dsh.ts chat                               # interactive REPL
node dsh.ts chat --token "$TOKEN" "hi"         # use an existing token, skip login
node dsh.ts balance                            # wallet balance, also validates the token
node dsh.ts serve --port 8787                  # local Anthropic /v1/messages proxy
```

Run `node dsh.ts --help` for all options.

## Auth flow

1. `POST https://platform.deepseek.com/auth-api/v0/dsh/auth_init` sends a S256 code challenge, a state, and a loopback `redirect_uri`.
2. The user signs in at the returned `authorize_url`.
3. The platform redirects to `http://localhost:<port>/oauth/callback?code&state`.
4. `POST .../auth_exchange` sends the code, the verifier, and a stable `device_id`. It returns `token` and `user`.

The token has no refresh. A 401 or platform code `40003` means you must sign in again.

Platform calls send the `x-client-*` headers from `platformHeaders()`.

## Inference

`POST https://api.deepseek.com/anthropic/v1/messages` uses the Anthropic Messages format with these headers:

| Header | Value |
| --- | --- |
| `x-dsh-auth-token` | account token |
| `anthropic-version` | `2023-06-01` |
| `user-agent` | `deepseek-harness/0.2.1-alpha.2 (+https://github.com/deepseek-ai/deepseek-harness)` |
| `x-deepseek-harness-user-id` | user id from login (optional) |
| `x-deepseek-harness-session-id` | session id (optional) |
| `x-deepseek-harness-compact` | `1` for compaction requests (optional) |

`normalizeBody()` applies the lobakai body rules:

- It removes every `cache_control`.
- It sets `max_tokens` to 256000 when absent and clamps it to 256000.
- It enables thinking by default with `output_config.effort = "high"`. It maps `xhigh` to `high`.
- It removes built-in server tools such as `web_search_*`.

## Proxy

`serve` accepts Anthropic requests and injects the token. It ignores incoming auth headers. It replaces unknown model ids with the default model.

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=dsh ANTHROPIC_MODEL=deepseek-v4-pro claude
```
