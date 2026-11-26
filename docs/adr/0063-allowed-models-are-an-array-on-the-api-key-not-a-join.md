---
status: accepted
areas: [api-keys, db]
---
# Allowed Models are an array on the API Key, not a join table

An API Key and an Integration may be restricted to a list of Models (`allowedModelIds` in `src/db/schemas/access.ts`); an empty list means every Model.

We decided to keep the list as an array column rather than a join table. With a join table, deleting a Model would cascade away its rows, and a key restricted to that Model alone would end up with an empty list, which means "every Model". Keeping the ids in an array means deleting a Model never widens a restricted key; the stale id simply matches nothing.

## Model Groups

An API Key and an Integration may also be allowed whole Model Groups (`allowedModelGroupIds`, another array for the same reason). The key is allowed the union of both lists, and both empty still means every Model. Group membership is read when a request arrives, so a Model added to an allowed group later is allowed and a Model removed from it no longer is. An allowed Model is reachable by its bare name and under every group prefix it has. A deleted group's id stays in the array and matches nothing, so a key restricted to that group alone never widens. Customer keys created through the control plane keep model ids only and must fall inside their Integration's full set of allowed Models: its listed Models plus every Model in its allowed groups. See ADR 0101.
