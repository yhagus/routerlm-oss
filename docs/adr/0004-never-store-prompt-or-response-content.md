---
status: accepted
areas: [usage, error-captures]
---
# Never store prompt or response content, except in Error Captures

The gateway carries other people's prompts. We decided that Usage Logs and Attempts record only measurements (tokens, cache counts, sizes, Cost, timing, status) and never the request or response content. The one exception is an Error Capture: when a request or an Attempt fails, its headers and body are stored so an operator can see why, and that body does contain the prompt. This includes an Attempt that failed while Fallback went on to answer the request, and a failed Playground request (ADR 0006).

An Error Capture's content lives only in Postgres and only for the Retention Period. Any other copy, such as a queued job that carries it, must be removed when the job ends, so nothing outlives the Retention Period.

## Consequences

- Error Captures are stored only for requests that carry a valid API Key, have credentials redacted from headers, are truncated past a size limit, and are deleted after a retention period (7 days by default, `ERROR_CAPTURE_RETENTION_DAYS`).
- There is no gateway response cache and no stored conversations (see ADR 0002).
- The Playground keeps its conversation in the browser only.
- A successful request can't be replayed or inspected afterwards. Debugging one means reproducing it.
