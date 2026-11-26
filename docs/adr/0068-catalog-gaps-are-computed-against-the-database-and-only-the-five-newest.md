---
status: accepted
areas: [catalog]
---
# Catalog Gaps are computed against the database and only the five newest models are checked

A Catalog Gap is an Upstream Model that models.dev lists among a Provider's newest but the Catalog does not hold. `ListCatalogGapsHandler` in `src/catalog/queries/handlers/list-catalog-gaps.handler.ts` produces the report.

We decided that the comparison runs against the Upstream Models in the database, not the shipped Catalog files, because an operator may have added or removed models since seeding. The shipped files are used only to map each Provider slug to its models.dev provider. A Provider missing from the database is skipped, since it was removed on purpose. Only the five newest models across the registered Providers are checked, so a report never holds more than five gaps.

## Consequences

- A model an operator deleted on purpose is reported again as a Catalog Gap.
