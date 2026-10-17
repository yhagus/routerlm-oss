# 05: Round-robin rotates across Connections

**What to build:** When an operator selects the round-robin strategy, requests spread across all eligible Connections. After the sticky limit, selection moves to the next Connection, not back to the first one.

**Blocked by:** None (can start immediately)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Connection selection).

- [ ] When the most recently used Connection reaches the sticky limit, selection picks the next eligible Connection in priority order after it. After the last one, it wraps to the first.
- [ ] Connections in cooldown, excluded for this request, filtered by a combo, or locked for the requested model are not eligible.
- [ ] Fill-first behavior does not change.
- [ ] Test (HTTP seam): three Connections, sticky limit 2, nine sequential requests. Each Connection receives three requests. The test reads the Authorization header that the mock Provider received.
- [ ] Test (HTTP seam): one of three Connections is in cooldown. Requests rotate across the other two.

## Comments

Implementer note: with sticky limit 2 and three Connections, nine requests give A=4, B=3, C=2 (sequence A A B B C C A A B), not 3/3/3. The test asserts the exact rotation sequence. If the most recently used Connection becomes ineligible, rotation restarts from the most recently used eligible Connection.
