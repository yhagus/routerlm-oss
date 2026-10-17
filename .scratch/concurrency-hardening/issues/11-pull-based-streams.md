# 11: Pull-based streams

**What to build:** Each chat stream reads from the Provider only when the client is ready for more data. A slow client no longer makes memory grow. A long response no longer keeps every chunk in memory. When the client disconnects, the remote image download for that request stops. Clients see the same stream format as before.

**Blocked by:** 01 (Load-test harness and event-loop metric), 08 (Global cap, per-API-key concurrency limit, and Fallback cap)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Streaming).

- [ ] The chat stream reads one upstream chunk when the client asks for data, not in a loop at stream start.
- [ ] The stream keeps a running Usage sniff and a bounded summary for the request detail. It does not keep every translated chunk.
- [ ] Stall timer, client-cancel propagation, Responses terminal events, `[DONE]`, Usage recording, and in-flight slot release behave as before.
- [ ] Remote image prefetch receives the request abort signal.
- [ ] Test (HTTP seam): streamed output for OpenAI, Claude, and Responses clients is the same frame for frame as before.
- [ ] Test (HTTP seam): a client that reads slowly causes the mock Provider to be read slowly (the mock records pending pulls).
- [ ] Test (HTTP seam): a client abort during image prefetch aborts the image fetch.
- [ ] Harness: a slow-client scenario shows stable peak RSS. Record before and after numbers under `## Comments`.

## Comments

Implementer note:

- `chat.ts` stream is now pull-based. Each `pull()` reads one upstream chunk, translates it, and enqueues its frames. The default high-water mark (1) keeps at most about one upstream chunk ahead of the client.
- The stall timer runs only while a read waits on the Provider. A slow client therefore never trips it. Provider silence still cancels the upstream reader, as before.
- A Provider read error now ends the stream like a normal end (terminal Responses frames, Usage, close). Before, the push loop closed the stream and then rejected `start()`.
- Slot release points: stream end and read error call `endPending()` in `finish()` (in a `finally`). Client cancel calls `endPending()` and cancels the upstream reader. Global and API key slots still return through `releaseWhenDone` (done, error, cancel).
- Bounded summary: `createStreamSummary` keeps a running Usage sniff (last `extractUsage` hit), the emitted text length for the estimate, and a `createCompletionAccumulator` (in `converters.ts`) capped at 64 KiB per text field and 64 tool calls. `mergeChunksToCompletion` uses the same accumulator without caps, so the JSON client path is unchanged. A request detail for a response above 64 KiB of text now stores the first 64 KiB.
- Image prefetch gets `input.signal`. `fetchImageAsBase64` now always applies its 10 s timeout and combines it with the caller signal (`AbortSignal.any`). Before, a caller signal removed the timeout. The prefetch loop stops when the signal is aborted.
- Legacy `createGateway` stream (`translateSse`, `recordStreamingUsage`) and the native Gemini forward use `pipeThrough(TransformStream)` or pass the body to `releaseWhenDone` (pull). Both already follow client backpressure. No change.
- Not changed: some executors build their own `ReadableStream` with a `start()` read loop (kiro, cursor, cursor-api, qoder, devin-cli, perplexity-web, grok-web, `utils/streamHandler.ts`). Those still read their upstream eagerly.

Harness: new options `--chunk-bytes <n>` (padding per SSE chunk) and `--client-read-delay <ms>` (a raw TCP client that pauses after each socket read; `fetch` reads the socket eagerly, so it cannot model a slow client).

Slow-client scenario: `bun run loadtest -- --streams 100 --rps 50 --duration 2 --chunks 300 --chunk-delay 2 --chunk-bytes 16384 --client-read-delay 200` (about 4.9 MB per stream, client reads about 1.2 MB/s).

| Run | Peak RSS | Loop lag p99 / max | TTFB overhead p50 / p99 | Stream p50 | 200 / no [DONE] |
|---|---|---|---|---|---|
| Before (integration tip b0eaa407) | 1521 MB | 4.9 / 109.1 ms | 11.9 / 1604.7 ms | 4416 ms | 100 / 0 |
| After | 341 MB | 7.2 / 13.2 ms | 3.0 / 1406.9 ms | 4216 ms | 100 / 0 |

TTFB p99 in this scenario includes client-side queueing behind the slow TCP reader, so it is not router overhead.

Standard scenario: `bun run loadtest -- --streams 200 --rps 20 --duration 20`.

| Run | Peak RSS | Loop lag p99 / max | TTFB overhead p50 / p99 / max | 200 / no [DONE] |
|---|---|---|---|---|
| Before (integration tip) | 140 MB | 5.4 / 17.0 ms | 3.7 / 10.5 / 13.3 ms | 394 / 0 |
| After | 117 MB | 3.2 / 21.9 ms | 3.3 / 11.8 / 39 ms | 393 / 0 |

No TTFB regression beyond run-to-run noise.

Orchestrator: accepted. Usage, request detail and slot release now run when the client reads to the end or cancels. Follow-ups outside this spec: executors that read upstream eagerly in their own start() loop (kiro, cursor, cursor-api, qoder, devin-cli, perplexity-web, grok-web, utils/streamHandler.ts); Responses client on an OpenAI-format Provider gets wrapped frames and 0-token Usage (pre-existing).
