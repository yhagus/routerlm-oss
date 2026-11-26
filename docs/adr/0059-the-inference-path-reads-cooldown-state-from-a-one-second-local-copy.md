---
status: accepted
areas: [upstream, inference]
---
# The inference path reads Cooldown state from a one second local copy of Redis

Every Attempt needs to know which Provider Accounts are in Cooldown, and reading Redis per request would put a round trip on the hot path.

We decided that `CooldownStore` keeps a per-process copy of each Provider Account's state, read from Redis in one MGET shared by concurrent requests when the copy is older than `LOCAL_COPY_MAX_AGE_MS` (1 second), and updated at once by this process's own writes. Another process's Cooldown therefore reaches this one within a second, which at worst costs one failed Attempt and a Fallback. A failed read counts as no Cooldown until the next read, so an outage costs at most one failed read a second. `resetRefusalsAfterSuccess` skips Redis when the local copy counts no refusals, so only a success after a 403 costs a write, and a 403 counted by another process moments ago may stay counted.
