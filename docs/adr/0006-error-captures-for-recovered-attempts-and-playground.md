# Capture recovered Attempts and Playground failures, and allow SDK names in /docs examples

The code review of the gateway branch raised three questions the spec left open. The maintainer decided each (2026-11-15).

**Recovered Attempts.** The spec captures "failed requests", which left out an Attempt that failed while Fallback went on to answer the request. We decided that every failed Attempt gets an Error Capture (the upstream's response headers and body, redacted and truncated, with the client request that was sent), even when a later Attempt answered. The request as a whole gets no client-to-gateway capture when it succeeded: that capture stays for requests that failed before any Attempt did.

**Playground failures.** The spec gives Error Captures only to requests with a valid API Key. The Playground signs in with a dashboard session instead. We decided that a valid session counts as a valid API Key for this rule, so failed Playground requests keep their Error Captures.

**SDK names in /docs.** The /docs pages name no Provider (spec "Docs"), but the client examples import the OpenAI and Anthropic SDKs, whose package and class names are those Providers' names. We decided that SDK names may appear in code examples. The prose stays Provider-free. `test/docs-examples.e2e-spec.ts` lists the exception as `SDK_OWNERS`.

## Considered Options

- Capturing only requests that failed as a whole. Rejected: an operator could not see why a Provider Account went into Cooldown when Fallback hid the failure from the client.
- Excluding Playground requests from Error Captures. Rejected: the Playground is where an operator reproduces a failing request, so its failures are the ones most worth reading.
- Writing the examples with raw `fetch` to avoid SDK names. Rejected: clients use the SDKs, and an example they can't paste is less useful.

## Consequences

- Error Captures can exist for successful requests. Each one is linked to its failed Attempt, so the Error Captures page shows which Provider Account failed.
- Content of a successful request is stored only when one of its Attempts failed, and for the same retention period as any Error Capture (ADR 0004).
- The docs test still fails if a Provider name other than an SDK owner appears in code, or if any Provider name appears in prose.
