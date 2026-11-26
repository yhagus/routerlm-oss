---
status: accepted
areas: [web, overview]
---
# Overview daily buckets are UTC days and are labelled in UTC

The backend aligns every Overview bucket to UTC (`GET /api/overview`). The dashboard labels daily buckets in UTC (`utcDay` in `web/app/lib/overview.ts`), not in the browser's time zone.

We decided to label them in UTC because a local date would name the wrong day for a viewer west or east of UTC: the bucket holds one UTC day of requests, not a local one.

## Consequences

- A bucket label can differ from the viewer's local calendar day; this is intended.
- Switching the labels to local time requires the backend to align buckets to the viewer's time zone first.
