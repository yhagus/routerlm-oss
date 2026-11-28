---
status: accepted
areas: [usage]
---
# Usage Logs are snapshots without foreign keys

A Usage Log answers "what happened then", so editing or deleting configuration must not rewrite it. Before this, `usage_logs` and `attempts` referenced API Keys, Users, Models, Routes and Provider Accounts through foreign keys with `ON DELETE SET NULL`. Deleting a Provider Account blanked its history, and since a row showed live names through joins, renaming a Model changed what old rows said.

We decided that Usage Logs and Attempts keep those references as plain indexed uuids with no foreign key, and copy the names they display at request time: the Model's name, the Upstream Model's id and name as the Provider spells it, the Provider's slug, the Provider Account's id and name, and the API Key's name; each Attempt also copies the Provider's name, which the Error Captures list shows. A Route has no name and stays a bare id. The Usage page reads only these copies and filters by id, never joining to configuration tables.

A Playground row keeps `user_id` and copies the User's email the same way, so it still shows who sent it after the User changes their email or is deleted. Only rows recorded before the email was copied show "deleted user" once the User is gone.

Links inside the record family stay: an Attempt and an Error Capture still cascade from their Usage Log, because they are parts of one record and retention deletes them together.

## Consequences

- A Usage Log's `upstream_model_id` and `provider_account_id` are always the ones that served it, so per-model and per-account figures stay correct after a Route is edited.
- A deleted API Key, Model or Provider Account still shows its name on old rows; a renamed one shows its old name there.
- The snapshot names are free-text columns. They are operator-entered configuration, not prompt or response content, so ADR 0004 holds; the records schema guard lists them in a named allowlist instead of loosening its rule.
- `cost` was already frozen at request time; unit prices are not copied.
- Nothing enforces that a stored id still exists. Code that follows one to a live row must expect it to be gone.
