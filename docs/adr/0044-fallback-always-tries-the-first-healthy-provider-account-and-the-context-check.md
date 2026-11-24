# Fallback always tries the first healthy Provider Account, and the context check errs low

Two choices in `src/inference/models/route-selection.ts` look like mistakes to a reader who does not know why.

Attempts go to each path's enabled Provider Accounts by priority, then the next path. We decided the first healthy account is always the one tried, never round-robin, because Provider prompt caches are per account: spreading requests over accounts would split one conversation's cache. A Provider Account that failed earlier in the same request is skipped lazily (`isSkipped` is asked as each target comes up), so it is also skipped on a later Route of the same Provider.

The context-size check uses a rough, deliberately low token estimate (`CHARACTERS_PER_TOKEN`). Skipping a Route that could have served the request is worse than letting the upstream refuse one that is slightly too long, so the estimate must not be made more cautious.

## Consequences

- Load is not spread across Provider Accounts; an operator who wants that sets priorities by hand.
- A request near the context limit may cost one failed Attempt before Fallback moves on.
