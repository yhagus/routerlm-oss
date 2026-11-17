# Settings a User changes from the dashboard live in the database, not in env

The Retention Period was an environment variable, so changing it meant editing the deployment and restarting the worker. We decided that a value a User should be able to change while the gateway runs is a Setting: a row in a `settings` table, read each time it is used, with its key, type, valid range and default declared in code. Env variables stay for what is fixed at deploy time (ports, database and Redis URLs). The old `ERROR_CAPTURE_RETENTION_DAYS` variable is removed, not kept as a fallback.

## Considered options

- Keep the env variable and only restart on change: no dashboard control, and every change is an operator task outside the product.
- Env as the default, with the database overriding it: two sources of truth, and the dashboard would have to explain which one is active.

## Consequences

- With no row, a Setting has the default from code. Deleting the row ("Reset to default") follows a new default in a later release; saving the default value explicitly pins it.
- Every User can change every Setting, like every other part of the dashboard (see User in the glossary).
- Shortening the Retention Period deletes Error Captures at the next hourly run, and that cannot be undone, so the dashboard asks for confirmation first.
- Instances that set `ERROR_CAPTURE_RETENTION_DAYS` fall back to 7 days without a runtime warning; the CHANGELOG records the break.
