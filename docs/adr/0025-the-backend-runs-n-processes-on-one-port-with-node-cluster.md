---
status: accepted
areas: [app]
---
# The backend runs N processes on one port with node:cluster

A backend process is one event loop, so the gateway used one CPU whatever the VM had. The k6 benchmark reached the second CPU only with two containers behind nginx, which a self-hoster running `deploy/compose.yaml` does not have. We decided that `src/main.ts` runs `BACKEND_PROCESSES` gateway processes (default 1) with `node:cluster`: the primary only forks and supervises, and each worker boots the whole app and listens on the same `PORT`. The queue worker (`src/worker.ts`) stays one process.

Bun's `node:http` servers in cluster workers each bind their own socket, and they share the port only on Linux, through `SO_REUSEPORT`; elsewhere Bun ignores it. So outside Linux a count above 1 logs one warning and runs a single process. The images run on Linux, so this only affects development on macOS and Windows.

The count is explicit rather than taken from `os.availableParallelism()`: a container's CPU limit (`cpus: 2`) is not what that call reports, which is the host's CPUs, so a default from it would start far more processes than the container can run. Self-hosters set it to the VM's CPU count.

The supervisor replaces a worker that exits unexpectedly. More than 5 unexpected exits within 60 seconds means the gateway cannot stay up, so the primary stops the other workers and exits 1, and Docker's `restart: unless-stopped` takes over. On SIGTERM or SIGINT the primary forwards the signal to every worker, waits for them to exit, then exits 0. Each worker closes its app through Nest's shutdown hooks.

docs.nestjs.com documents no first-party option for running several processes: it covers the HTTP adapters, and `@nestjs/locks` is for cron jobs. This is a native implementation (ADR 0001), kept out of Nest: the primary never creates a Nest app.

## Considered Options

- A reverse proxy in front of N containers, as the k6 `dual` topology does. Rejected: it adds a service and a config file to every install, for what the kernel does for free on one port.
- Independent processes started by a script, each binding the port with `reusePort`. Rejected: the script would need its own supervisor, while `node:cluster` gives the primary each worker's exit and a channel to stop them.
- A count taken from the CPUs the runtime reports. Rejected: see above.

## Consequences

- Every process holds its own snapshot (ADR 0020), Postgres pool and Redis connections, so memory and connections grow with the count.
- State that must be shared already lives in Redis (login throttling, OAuth refresh locks, snapshot change notices), so no other code changed.
- Benchmark with `TOPOLOGY=cluster` in `tests/k6/`.
