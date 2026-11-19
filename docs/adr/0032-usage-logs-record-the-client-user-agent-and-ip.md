# Usage Logs and Error Captures record the client's User-Agent and IP

Status: accepted

To diagnose failures across many requests (which SDK version sends the bad requests, where a key is being used from), we decided that every Usage Log and Error Capture records the client's User-Agent and IP address. Each Attempt also records the request id the Provider returned, the one value a Provider's support asks for.

## Considered options

- Keep the IP only in the Error Capture, so it expires with the Retention Period. Rejected: diagnosis and spotting a leaked API Key need the IP on successful requests too, and over the whole history.
- Store all request headers on every Usage Log. Rejected: the Error Capture already keeps them for failures, which is when they matter, and Usage Logs are never deleted.

## Consequences

- Usage Logs are never deleted, so a client's IP address is kept for as long as the instance keeps its Usage Logs. In most privacy regimes an IP address is personal data, and whoever runs the gateway is responsible for it.
- The IP is the address the HTTP adapter resolves through `TRUST_PROXY`, never the raw `X-Forwarded-For` header, which a client can forge. Behind a proxy that isn't trusted, every request records the proxy's address.
- The User-Agent is truncated to a fixed length.
- Neither is content, so ADR 0004 still holds: Usage Logs never store prompts or responses.
