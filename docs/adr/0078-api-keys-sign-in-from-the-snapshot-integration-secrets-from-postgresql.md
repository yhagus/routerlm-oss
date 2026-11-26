---
status: accepted
areas: [api-keys, integrations, snapshot]
---
# API Keys sign in from the snapshot, Integration Secrets from PostgreSQL

Both `ApiKeyAuth` and `IntegrationSecretAuth` extend `ApiKeyProvider`, and a reader may expect them to look keys up the same way.

We decided that API Keys are found in the in-memory snapshot (`apiKeysByKeyId`), because the inference path reads no PostgreSQL, and that revoked keys are simply not in it. Integration Secrets are read from PostgreSQL (`findKey` in `src/integrations/providers/integration-secret-auth.ts`), because the control plane is not the inference hot path, and a disabled Integration reads as unknown. The provider checks the hash and expiry itself in both.

## Consequences

- Moving Integration Secrets into the snapshot would need change notices on every secret use and rotation for no hot-path gain.
