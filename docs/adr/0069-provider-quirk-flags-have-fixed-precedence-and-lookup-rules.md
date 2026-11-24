# Provider quirk flags have fixed precedence and lookup rules

Provider quirks (`providerQuirksSchema` in `src/catalog/schemas/catalog.schema.ts`) are per-Provider data read by the Protocol adapters (ADR 0003). Several flags carry rules that their names do not show.

We decided that: `reasoningAsThinking` Providers always have thinking enabled, because their models cannot turn it off; `fixedHeaders` override the client's `forwardedClientHeaders` of the same name, since the adapter depends on them, and the Provider Account's credential overrides both; and `exhaustedErrorCodes` match a number against `base_resp.status_code`, `status_code`, `code` or a `(code)` at the end of `error.message`, and a string against a `code` or `type` anywhere in the error body's nested objects, making the account Exhausted instead of putting it in Cooldown.
