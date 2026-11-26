---
status: accepted
areas: [web]
---
# A missing record's error page shows fixed text, never the backend's message

`missingResourceError` in `web/app/lib/errors.ts` raises the 404 for a detail page whose record does not exist. Its message is fixed text per resource (`MISSING_RESOURCE_HINTS`), not the backend's message.

We decided on fixed text because the backend's message can name the record's id, which the dashboard never shows.

## Consequences

- Passing the backend's message through to the error page would put record ids on screen.
