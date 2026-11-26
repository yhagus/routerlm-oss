---
status: accepted
areas: [api-keys]
---
# API Keys are stored encrypted so they can be copied again

An API Key used to be shown once, at creation, and only its SHA-256 hash was stored. Operators wanted to copy a key from the dashboard later, for example to configure a second client, without rotating it. We decided to also store each key encrypted, with the same AES-256-GCM cipher and `ENCRYPTION_KEY` that protect Provider Account keys, bound to its own purpose so neither ciphertext decrypts as the other. Requests still authenticate against the hash; the ciphertext is read only when a User asks to copy the key.

## Considered options

- Hash only, with rotation as the way to get a new copy: the safest storage, but every lost copy means updating every client that uses the key.
- Store the key in plain text: no protection if the database leaks.

## Consequences

- Anyone signed in to the dashboard can copy any active key, not only the User who created it.
- A database leak together with `ENCRYPTION_KEY` exposes every active key; the database alone does not.
- Revoking a key drops its ciphertext, so a revoked key can never be shown again.
- Keys created before this change have no ciphertext and can't be copied; rotating one gives it a new, copyable key.
- Rotating `ENCRYPTION_KEY` makes every stored key uncopyable until it is rotated, though the keys keep working.
