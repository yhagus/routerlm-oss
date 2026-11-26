---
status: accepted
areas: [inference, error-captures]
---
# Upstream error text is logged and captured, never sent to the client

Upstream error text can reveal which Provider served a request, quote prompt content or carry keys. We decided that a `GatewayError` message is the gateway's own wording and safe to send, that `UpstreamProtocolError` and `AttemptFailure` bodies may quote upstream text but go only to the log, the dashboard and Error Captures (ADR 0006), and that media-host and network failures reach the client as the gateway's words, not the host's. The client Protocol's converter writes the `GatewayError` in that Protocol's envelope; the Error Origin is set by the code that knows the cause (ADR 0031).
