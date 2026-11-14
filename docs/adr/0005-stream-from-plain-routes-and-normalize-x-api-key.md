# Stream inference from plain POST routes, and normalize `x-api-key` into a Bearer header

The spec listed `@Sse` for streaming responses and `@nestjs/authentication`'s `ApiKeyProvider` for API Keys, and asked the first inference ticket to check both. Two gaps turned up, and the maintainer decided how to handle each (2026-11-15).

**Streaming.** One inference route (for example `POST /v1/chat/completions`) must answer JSON or a stream depending on the body's `stream` flag, and `@Sse` turns the whole handler into an event stream. `@Sse` also writes an `id:` line on every event, so the bytes can't match a Protocol's own framing. We decided that inference routes are plain `@Post` handlers that return a web `Response` with a `ReadableStream` body for streaming requests, as docs.nestjs.com documents in "Streaming responses" (`@nestjs/core` 12.4 and later). The converters write the server-sent-event text themselves, so each Protocol keeps its framing: Anthropic's named events, OpenAI's closing `data: [DONE]`.

**`x-api-key`.** `ApiKeyProvider` reads only `Authorization: Bearer`, but Anthropic clients send their key in `x-api-key`. We decided that a small Nest middleware on `/v1/*` copies `x-api-key` into `Authorization: Bearer <key>` when no Authorization header is present. `ApiKeyProvider` still does every lookup and hash check.

## Considered Options

- `@Sse` with a second, non-streaming route per endpoint. Rejected: clients send both kinds of request to the same path.
- Writing to the raw Node response with `@Res()`. Rejected: Nest then skips exception filters and interceptors for the route, and docs.nestjs.com does not document it as a pattern.
- A custom `AuthenticationProvider` reading `x-api-key`. Rejected: it would repeat the key parsing and hash comparison that `ApiKeyProvider` already does.

## Consequences

- Errors raised before the first chunk go through exception filters and get a proper status and error envelope. That is why the gateway waits for the upstream's first stream event before answering. After that the status is sent, so a failure ends the stream with the Protocol's error event.
- When the client disconnects, Nest cancels the response body at once. The gateway also watches the response's `close` event, and either one aborts the upstream call.
- A request carrying both headers is authenticated by its `Authorization` header.
