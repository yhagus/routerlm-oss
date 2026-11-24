# Provider URLs are https and public unless the deployment allows otherwise

Status: accepted, but ADR 0030 replaces its env variable with a Setting

`baseUrl`, `quotaBaseUrl` and the `oauthLogin` hosts and issuer accepted any `z.url()`, and the dashboard accepts a `baseUrl` for a new Provider (ADR 0003). The gateway sends a Provider Account's credential to that host and stores the response in Error Captures, so a hijacked session could aim credentials at an attacker's host or read internal services through the gateway. Every User is an equal operator (see the glossary), so this is not a permission split between Users. It limits what a stolen session can reach. We decided:

- These URLs must be `https` and must not point at `localhost`, loopback, private or link-local addresses. The write schema enforces it, so every dashboard path and the Catalog files are covered.
- The check is repeated at connect time: the shared outbound-client helper in `src/libs/` resolves the host and refuses a private, loopback or link-local result. This covers a hostname that resolves privately, or changes later (DNS rebinding). It applies to the inference, quota and OAuth clients.
- One deploy-time env variable lifts both rules, for self-hosters who run Ollama or vLLM on a LAN. It is an env variable and not a Setting (ADR 0017), because a dashboard toggle would let a hijacked session switch the rule off. The test stack sets it for the fake upstream on localhost.

The connect-time check in `OutboundFetch` resolves the host itself, but the connection resolves the name again, so a rebind in the milliseconds between the check and the connect is not covered.

A stored `quotaBaseUrl` that no longer passes the URL policy is kept as stored (`storedProviderQuirksSchema`): only the quota reader uses it and it reports the error itself, so it must not fail inference.

## Considered Options

- A write-time check on the host literal only. Rejected: it gives a false sense of safety, since a public name can resolve to a private address.
- Restricting to `https` but allowing private ranges. Rejected: it leaves the internal-network read in place.
- A dashboard Setting for the exception. Rejected for the reason above.

## Consequences

- A self-hoster with a LAN upstream must set the env variable; the CHANGELOG and deploy docs say so.
- Existing Providers with a now-invalid URL keep their stored value but fail at connect time with a clear error, until the operator fixes the URL or sets the variable.
- Kimi's `webLinkSchema` already uses the https-only pattern; the others follow it.
