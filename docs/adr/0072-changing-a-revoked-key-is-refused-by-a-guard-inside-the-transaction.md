# Changing a revoked key is refused by a guard inside the transaction, not only by the earlier check

The dashboard and the control plane both update and rotate API Keys, and rotate Integration Secrets. Each handler first checks that the key is not revoked, then writes. Between the check and the write another request can revoke the key, or rotate it.

We decided that the write itself repeats the guard: the update and rotate handlers (`src/api-keys/commands/handlers/update-api-key.handler.ts`, `rotate-api-key.handler.ts`, `src/control-plane/commands/handlers/update-customer-api-key.handler.ts`, `rotate-customer-api-key.handler.ts`) filter on `revokedAt IS NULL` in the statement, so a key revoked since the check gets no change and no new copy. Rotation also locks the row inside its transaction, so two concurrent rotations cannot record the same previous key. `RotateIntegrationSecretHandler` locks the same way so a concurrent rotation cannot record the same previous secret.

## Consequences

- The earlier check stays for the friendly 409; the guard is what makes the outcome correct.
- Removing the lock or the `revokedAt` filter as redundant reintroduces a race that tests will not usually catch.
