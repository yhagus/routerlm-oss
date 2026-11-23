# Usage Resets are stored, and their list is fetched again only when the count disagrees

An operator picks which Usage Reset to spend, since each one expires on its own date, so the gateway needs each Provider Account's list of resets. OpenAI Codex serves that list from its own endpoint, while the usage reading the gateway already makes every few minutes for Quota Meters (ADR 0010) carries only how many resets are available.

We decided to store the list, replacing it as a whole like Quota Meters, and to fetch it again only when there is a reason: the reading's count differs from the number of stored resets that haven't expired, the gateway has just spent a reset, or the Provider refuses a reset as already spent or missing. A reset that expires is dropped by its expiry date, with no fetch. Opening the picker reads only the database. The count is never stored on its own: how many resets an account has is the number of stored resets that haven't expired, and the reading's count is only compared against it.

## Considered Options

- Fetching the list live each time the picker opens. Rejected: an upstream call on every look, and nothing to show while the Provider is slow or down.
- Fetching the list with every quota reading. Rejected: doubles the calls to the Provider for a list that rarely changes.

## Consequences

- If, between two readings, the account's owner spends a reset elsewhere and receives a new one, the count stays the same and the stored list is stale. Picking the spent reset gets a refusal, which triggers a fetch and repairs the list. We accept that one wasted click rather than add a periodic fetch.
