# ADR 0015: Store current provider quota snapshots

## Status

Accepted

## Context

The dashboard requested each provider quota during page loading.

Provider requests delayed the quota tracker and provider detail pages.

Provider requests could exceed provider rate limits.

## Decision

The application stores one current quota snapshot for each provider connection.

The `quotaSnapshots` table stores raw provider quota data and refresh state.

The dashboard reads quota values only from stored snapshots.

The quota scheduler refreshes due snapshots in the background.

The scheduler runs at most four provider requests at one time.

The scheduler refreshes Claude snapshots every three minutes.

The scheduler refreshes other snapshots every one minute.

The scheduler applies exponential retry delays after failures.

Manual refresh requests wait for one priority refresh task.

The application keeps the previous snapshot after a refresh failure.

## Consequences

The dashboard loads quota values without provider network latency.

The first application run shows a pending value until the scheduler completes.

The dashboard shows the snapshot age and refresh error in the response metadata.

The application does not store quota history.
