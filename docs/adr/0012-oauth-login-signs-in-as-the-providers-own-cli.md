# An OAuth Login signs in as the Provider's own CLI

Kimi Code subscribers who sign in through Kimi's own login have no API key, so they could not add their subscription as a Provider Account. Kimi offers sign-in to one client only: its official Kimi Code CLI, through the OAuth device-code grant (RFC 8628). It has no way to register a third-party client. We decided that a Provider Account holds one of two credentials, an API key or an OAuth Login, and that the gateway obtains an OAuth Login by running the device-code grant with the official CLI's client id and presenting the CLI's identity (`User-Agent: kimi-code-cli/<version>` and the `X-Msh-*` headers, with a device id generated once per Provider Account) on calls to the auth host and on inference calls. The gateway then holds a refreshable credential: an access token, a rotating refresh token and their expiry, encrypted with the same cipher as API keys and never returned by the API.

This follows ADR 0003: the device-code flow is code, and what names the Provider is data on the Provider row (`oauthLogin`: the auth host of each region, the client id and the CLI version to present), shipped in the Catalog and editable by the operator. No flow code names a Kimi host, so a Provider with the same flow needs only data. The CLI identity headers are the one Kimi-specific part of the code. Nest has no first-party OAuth client (ADR 0001), so the grant is a native provider on the existing HTTP client, Redis and queue modules.

A sign-in in progress is short-lived state in Redis, not a database row, and expires on its own. The gateway does the polling, with one delayed queue job per poll that the worker runs: the wait between polls is held by the queue, so a restart of the backend or the worker loses nothing, and the dashboard only reads the state. A sign-in therefore needs Redis and a running worker.

API key accounts keep identifying the gateway honestly as `routerlm/<version>`; only an OAuth Login presents the CLI.

## Considered options

- Importing the CLI's credentials file: refresh tokens rotate, so the gateway and a local CLI sharing one login would invalidate each other on every refresh.
- An honest client identity for the sign-in: Kimi issues no client id to third parties, so there is nothing to sign in with.
- Storing OAuth data in `quirks`: quirks are deviations from a Protocol that its adapter reads, and whether a Provider offers sign-in says nothing about its Protocol. Like `quotaReader`, it is a Provider field of its own.
- Polling from a timer in the backend process that started the sign-in: a restart would silently drop the sign-in, and several backend instances would each need to know who polls.
- A database table for pending sign-ins: they live for minutes and need no history.

## Consequences

- Moonshot may block clients that present the CLI's identity without being it, or change the flow without notice. We accept that risk; an OAuth Login would then stop working until the Provider data or the code catches up, while API key accounts are unaffected.
- The CLI version in the Provider data goes stale as Kimi releases. An operator can raise it on the Provider without a deploy.
- Inference and quota readings for an OAuth Login use the Provider's one base URL, whichever region signed in (ADR 0003). Whether a token issued by the global auth host works there is unverified; if Kimi refuses it, the fallback is a second Provider.
- A Provider Account's key columns are empty for an OAuth Login and its login columns are empty for an API key; `credentialKind` says which it holds.
- An OAuth Login is renewed lazily, by the Attempt or quota reading that needs it, under a lock per Provider Account from the first-party `@nestjs/locks` (ADR 0001), whose store is in Redis so the backend and the worker share it. The Provider Account keeps when its login was granted, so that half its lifetime is known. A login the Provider no longer renews disables the Provider Account, and only a new sign-in on that account restores it.
