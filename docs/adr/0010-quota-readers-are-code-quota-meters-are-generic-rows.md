# Quota readers are code, Quota Meters are generic rows

Subscription Providers report remaining usage in shapes that have nothing in common: MiniMax M Plan returns percentages for a 5-hour and a weekly window per model group, others report counts, tokens or money, and some report nothing. A Provider's inference Protocol says nothing about how it reports quota. We decided that a Provider names a quota reader in its data, the code holds one reader per quota endpoint shape, and every reader returns the same generic Quota Meter rows (a key such as `5h` or `weekly`, a unit, used and limit when known, remaining percent, window length, reset time, an optional scope, and the raw payload). One row per Provider Account and meter key holds the latest reading; there is no history table.

This extends ADR 0003: Protocols and quota readers are both code chosen by Provider data, and everything else stays data.

## Considered options

- A table or columns per Provider's quota shape: every new Subscription Provider would need a migration and new dashboard code.
- Counting usage locally against configured limits: the Provider's own accounting (shared with other tools on the same plan) is the only accurate source.

## Consequences

- Adding a Subscription Provider means writing one reader, with no migration and no dashboard change.
- Provider-specific fields that don't fit the generic row are kept in the raw payload rather than lost.
- A history of readings can be added later as a separate table without changing the snapshot rows.
