---
status: accepted
areas: [inference]
---
# A non-stream Attempt is bound by its total timeout alone; a stream also gets a header and a first-event timeout

`fetch` exposes neither the TCP/TLS connection nor the moment the request is sent, so the first thing an Attempt can observe is the response headers. A streaming upstream sends them as soon as it accepts the request, but a non-stream one sends them only with its finished answer, which can take minutes for a long or reasoning-heavy reply.

We decided that `UpstreamClient` binds a non-stream Attempt by `totalMs` alone, and gives a stream all three timeouts (headers, first event, total). A media Attempt likewise uses only `totalMs`.

## Consequences

- A hung non-stream upstream is noticed only at the total timeout.
