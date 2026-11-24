# Allowed Models are an array on the API Key, not a join table

An API Key and an Integration may be restricted to a list of Models (`allowedModelIds` in `src/db/schemas/access.ts`); an empty list means every Model.

We decided to keep the list as an array column rather than a join table. With a join table, deleting a Model would cascade away its rows, and a key restricted to that Model alone would end up with an empty list, which means "every Model". Keeping the ids in an array means deleting a Model never widens a restricted key; the stale id simply matches nothing.
