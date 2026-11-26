---
status: accepted
areas: [inference, playground]
---
# Every routing side effect of an Attempt happens in a named place so a Probe can avoid them all

A request's Attempts change routing state: counters, Cooldown, Exhausted, disabled accounts. A Probe must observe a Provider Account without changing it (GLOSSARY "Probe").

We decided that `AttemptRunner` in `src/inference/providers/attempt-runner.ts` keeps each side effect in one named method, and that the Probe path (`probeAnswer`) calls none of them:

- refusal counter reset on success: the Fallback loop in `firstAnswer`;
- disable on 401, Cooldown and Exhausted: `afterFailedAttempt`;
- 403 refusal counter, then Cooldown or disable (ADR 0023): `afterForbiddenAttempt`;
- quota read: `readQuota`;
- disable of an OAuth Login whose refresh is refused: credential reading in `ProviderAccountCredentials`, unless `CredentialReadOptions.disablesRefusedLogin` is off.

## Consequences

- A new routing side effect must be added to this list and kept out of the Probe path.
