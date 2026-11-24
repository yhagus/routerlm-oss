# Deleting an Integration revokes its API Keys before the delete clears their link to it

Deleting an Integration clears `integrationId` on the keys it issued (ADR 0033, ADR 0034). Once cleared, they cannot be told apart from operator keys.

We decided that `DeleteIntegrationHandler` revokes every key of the Integration, as `RevokeApiKeyCommand` does, in the transaction before the row is removed, so nothing it issued keeps working. Usage Logs keep its name (ADR 0024).

## Consequences

- Reordering the delete before the revoke leaves the keys working as operator keys.
