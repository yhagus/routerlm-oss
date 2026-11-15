# Feature tests only, one folder per feature

The repository had two kinds of test: unit specs beside the code (`src/**/*.spec.ts`), which called functions directly, and e2e tests in `test/`, which drove the running app. Unit specs pinned internal function signatures, so refactors broke them even when behaviour stayed the same, and the same behaviour was often tested twice. We decided (2026-11-15) to keep only feature tests.

A feature test drives the app from outside: an HTTP request, a CLI command such as `bun run db:seed`, or booting the app. It asserts what can be observed: the response, the rows in the database, the request the fake upstream received. Tests live in `tests/<feature>/<scenario>.test.ts`, for example `tests/usage/summary.test.ts`. Shared helpers (the test app, the fake upstream, fixtures) live in `tests/support/`. They run against real Postgres and Redis: `bun run test` uses `TEST_DATABASE_URL` and `REDIS_URL`, and `bun run test:docker` starts throwaway containers. `bun run check` covers lint, format and types only, so it stays fast and needs no services.

## Considered Options

- Keep unit specs for pure logic (converters, cost calculation). Rejected: every such case can be reached through the API with the fake upstream, and testing it there also proves the wiring.
- One folder per scenario. Rejected: folders of one file each, and helpers shared by a feature had no home.

## Consequences

- A case that cannot be reached from outside is either dead code or needs a real entry point. It is not tested through a private seam.
- Some cases are slower or coarser from outside: the cooldown test waits out a real 5 s cooldown, and the 5-minute cooldown cap and malformed catalog files are not tested, because `db:seed` only reads the shipped data folder.
- Test files share one database and truncate it, so they run one file at a time.
