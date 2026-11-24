# An API Key restricted to a Model stays restricted when that Model is deleted

An API Key lists the Models it may use, and an empty list means every Model. A Model can be deleted while keys still name it.

We decided that the key stays restricted to the deleted Model rather than widening to all Models. `AllowedModel` in `src/api-keys/models/api-key.ts` carries `name: null` for such a Model, so the dashboard can show that a restriction exists. Widening would hand a restricted Customer's key access to every Model the moment one Model is deleted.

## Consequences

- A key whose only allowed Model is deleted can call nothing until someone edits it.
- Code that reads allowed Models must treat a missing Model as a restriction, never as an empty list.
