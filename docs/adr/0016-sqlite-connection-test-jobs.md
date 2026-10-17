# ADR 0016: Store connection test jobs in SQLite

## Status

Accepted

## Context

The provider detail page tested every connection in the browser.

The browser loop stopped if the user closed the page.

The application already stores state in SQLite.

The application does not use Redis.

## Decision

The backend stores one connection test job and its items in SQLite.

The dashboard starts a job with `POST /api/providers/test-jobs`.

A process worker tests one connection at a time.

The dashboard reads job progress from SQLite.

A restart cancels jobs that were still queued or running.

## Consequences

A connection test continues after the dashboard closes.

The application does not need Redis for this queue.

Only one active job can run for each provider.
