---
status: accepted
areas: [upstream]
---
# OAuth sign-in secrets are stored encrypted, kept out of errors and never sent to another host

A device code, and for OpenAI Codex the device auth id, lets whoever holds it collect the tokens; the tokens themselves are credentials.

We decided that `OauthSignInStore` keeps the device code as ciphertext (`encryptedDeviceCode`), that `failureOf` in `poll-oauth-sign-in.handler.ts` reports why a write failed without the statement, because a failed query's own message quotes its parameters, which here include the tokens' ciphertext, and that the `OAUTH_LOGIN_HTTP_CLIENT` registered in `UpstreamModule` does not retry (except a refresh) and fails on a redirect rather than carry a device code or a token to another host.
