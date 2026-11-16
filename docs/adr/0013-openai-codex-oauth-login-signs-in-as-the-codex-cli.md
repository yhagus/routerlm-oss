# An OpenAI Codex OAuth Login signs in as the Codex CLI

ChatGPT subscribers use Codex through their plan, not through an OpenAI API key, and the plan is served from `chatgpt.com/backend-api/codex`, not `api.openai.com`. OpenAI registers no third-party clients for it. Following ADR 0012, we decided that OpenAI Codex is its own Subscription Provider that accepts only an OAuth Login, and that the gateway obtains that login by running the Codex CLI's device-code sign-in (`codex login --device-auth`) with the CLI's public client id, then presents the CLI's identity (`originator: codex_cli_rs`, its `User-Agent` and `version` headers) on inference and quota calls.

The Provider row's `oauthLogin` names its flow (`kimi-code` or `openai-codex`) and each flow has its own data shape. Codex's is the issuer, the client id and the CLI version, with no regions. The flow itself is code, like quota readers (ADR 0010): the device-auth paths on the issuer, the exchange at `/oauth/token`, and reading the account id, email and plan type from the id_token's claims instead of calling a profile endpoint. The account id is sent as `chatgpt-account-id` on every call. A Provider also states which credential kinds it accepts, so an API key cannot be added to OpenAI Codex.

## Considered options

- Browser PKCE with a localhost callback, the CLI's default: OpenAI only allows its own `127.0.0.1` redirect, which an operator's browser cannot reach on a self-hosted gateway.
- Exchanging the id_token for an OpenAI API key, which the CLI's browser login does: the key bills the API Platform, not the plan, which defeats the Provider.
- Fetching the model list live from the Codex `/models` endpoint: Upstream Models stay Catalog data (ADR 0003).

## Consequences

- OpenAI may block clients that present the CLI's identity, disable device login (a 404 on the usercode call), or change the flow. We accept that risk as for Kimi; API key Providers are unaffected.
- The refresh token rotates and is single use. A refresh that fails permanently (401, `invalid_grant`, `refresh_token_expired`, `refresh_token_reused`, `refresh_token_invalidated`) disables the Provider Account until a new sign-in, as in ADR 0012.
- A Team user with several workspaces gets the workspace they pick on OpenAI's device page. The gateway offers no picker.
