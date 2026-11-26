---
status: accepted
areas: [routing, inference, db]
---
# A Model is published once per Model Group, and its bare name still resolves

A Model belongs to one or more Model Groups, and `/v1/models` lists it once per group as `<group slug>/<model name>`, with `owned_by` set to the slug. A client may send either that form or the bare model name, and both reach the same Model with the same Routes and Parameter Policy. The group names a Model; it never changes how it routes. We kept the bare name so that existing clients and Integrations keep working, and we made groups many-to-many so that one Model can be offered under several labels without copying its Routes.

Resolution tries an exact Model name first and only then splits on the first `/`. Model names created or edited from now on cannot contain `/`, and slugs are `[a-z0-9-]`, so the two forms can't collide. A legacy name that already contains `/` keeps resolving through the exact match. Models that existed before groups have none: they're listed once under their bare name with `owned_by: "routerlm"` until they're edited, and edits require at least one group. A Model Group that is some Model's only group can't be deleted.

Usage Logs keep `model_name` as the Model's name and add `requested_model_name` with the exact string the client sent.

## Consequences

Clients hard-code `<slug>/<name>`, so changing a slug or removing a Model from a group breaks those strings. The dashboard warns about this before saving a slug change.
