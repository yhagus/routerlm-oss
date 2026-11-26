---
status: accepted
areas: [inference]
---
# The gateway relays media bytes and never returns upstream URLs

Alibaba returns generated images, speech and videos as signed URLs valid for 24 hours. Returning them would show clients which Provider served the request. We decided that the gateway fetches the media and relays the bytes: images as `b64_json` (ADR 0015), speech as audio in the requested format, and video content streamed through on `GET /v1/videos/{id}/content`. Nothing is stored (ADR 0004).

## Consequences

- Every media byte crosses the gateway, so bandwidth and request time grow with output size, video most of all.
- Media hosts are chosen by the Provider (object storage buckets), not configured by an operator, so ADR 0019's Provider URL check does not apply. A media fetch must be HTTPS and must not resolve to a private or internal address.
- `response_format: "url"` stays unsupported.
