---
status: accepted
areas: [inference]
---
# An Attempt reads the upstream failure before it aborts its own stream

Closing or finishing an upstream stream in `src/inference/providers/upstream-client.ts` aborts the Attempt's controller with `ClientCancelledError`. If that ran first, the cancellation would hide an upstream error status and stop the Fallback that the status should trigger. We decided that the reader takes the failure before `close()` or `finish()`, in both the batch reader and the stream opener, and that this order must not be rearranged.
