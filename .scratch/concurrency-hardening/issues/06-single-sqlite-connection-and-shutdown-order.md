# 06: Single SQLite connection and shutdown order

**What to build:** All backend code uses the one SQLite connection that the runtime opens. `BACKEND_DATABASE_PATH` controls the only database file. A normal stop writes the last Usage batch and request details before the process exits.

**Blocked by:** None (can start immediately)

**Status:** done

Spec: `.scratch/concurrency-hardening/spec.md` (Single data layer).

- [ ] The legacy platform data layer stops opening its own SQLite connection. Its callers move to the repositories, or the layer uses the runtime SQLite handle.
- [ ] The legacy adapter signal handlers and its periodic `TRUNCATE` checkpoint are removed. Only the main entry point handles shutdown signals.
- [ ] Shutdown order: stop the server, stop schedulers, flush Usage and request details, close SQLite, exit.
- [ ] Legacy readers (Usage stats, request logs, key-value store, model context windows, device store) return the same data as before.
- [ ] Test (HTTP seam): with `BACKEND_DATABASE_PATH` set to a path that differs from `DATA_DIR`, a chat request and a legacy-layer read or write use the same file. No second database file is created.
- [ ] Test: queued Usage rows are in the database after the runtime close sequence runs.
