# A Provider's invalid stored quirks fail only the requests that use it

The snapshot keeps each Provider's stored quirks as a safe-parse result (`SnapshotProvider.quirks`, `validQuirksOf` in `src/snapshot/models/snapshot.ts`).

We decided that quirks that no longer validate are not an error of the snapshot load. They throw their validation error only when a request uses the Provider, so one bad Provider row never stops the gateway from reloading its snapshot (ADR 0020) or serving other Providers.
