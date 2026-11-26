---
status: accepted
areas: [snapshot]
---
# The snapshot reloads on an interval as well as on change

A dashboard write reloaded the writing instance and told the others over Redis pub/sub. A failed reload kept the previous snapshot, and a failed or lost publish was only logged, so a revoked API Key (or a disabled Provider or Route) could keep working on an instance until the next change. We decided that every instance also reloads from the database on a fixed interval (30 seconds, set by a deploy-time env variable), and that `changed()` retries a failed local reload with backoff until it succeeds. A revoke still returns 204 once the row is written. The worst-case delay is bounded by the interval instead of being unbounded.

The interval uses `@nestjs/schedule`, the first-party option documented on docs.nestjs.com. A BullMQ job would run once for the whole fleet, and every instance needs its own reload.

Reloads of one instance run one after another so the last always reads the latest writes. The Redis publisher fails at once while Redis is down instead of holding the dashboard write, the subscriber reloads on every (re)connect to catch up on lost messages, and a failed reload keeps the previous snapshot, including the Allow private upstreams value, so a database blip cannot cut off working LAN upstreams.

## Considered Options

- A version check in Redis. Rejected: it fails exactly when Redis is down, which is one of the faults being covered.
- Making revoke fail loudly when propagation fails. Rejected: the row is already committed, so an error would report a failed revoke that actually happened.
- Retry only, with no interval. Rejected: it cannot recover a lost pub/sub message on a peer.

## Consequences

- Each instance runs a full snapshot query every interval, a small constant load.
- Revocation and disabling are not instant on peers during a Redis fault; they take effect within one interval.
- The interval is an env variable, not a Setting: it is fixed at deploy time (ADR 0017).
