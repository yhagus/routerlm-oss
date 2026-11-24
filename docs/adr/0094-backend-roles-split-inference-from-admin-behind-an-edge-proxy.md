# Backend roles split inference from admin behind an edge proxy

One backend container served inference (`/v1`), the dashboard API (`/api`) and the control plane over HTTP (`/integration/v1`) on one port. A heavy Overview query or a Playground stream competed with Customers' inference for the same event loops and Postgres pool, and a burst of inference could slow the dashboard. We decided that the `routerlm-backend` image takes a `BACKEND_ROLE` setting, `all` (the default), `inference` or `admin`, and that every stack we ship, `deploy/compose.yaml` and the development `docker-compose.yml`, runs one `inference` and one `admin` container behind Caddy as the edge proxy. The goal is isolation, not throughput: dashboard traffic is small, and inference still scales through `BACKEND_PROCESSES` (ADR 0025) or replicas.

`AppModule.forRole(role)` decides what loads. `inference` serves the inference endpoints and `/health`; `admin` serves the dashboard API, the Playground, the control plane over HTTP and `/health`; any other path answers Nest's usual 404, and `/` answers only in `all`. `admin` leaves out the inference controller (`InferenceModule.overHttp()` adds it) but keeps the inference handlers, which the Playground runs through. `inference` leaves out the modules that only the dashboard or control plane use, but several feature modules (API Keys, Settings, Upstream and others) hold dashboard controllers beside providers inference needs, so `inference` keeps them and closes `/api` with a middleware that answers that same 404. `all` stays for running the backend outside these stacks.

Caddy is the only service on the host's ports:

- The API address (`ROUTERLM_API_ADDRESS`, default `:3000`): `/v1/*` and `/health` go to `inference`, `/integration/v1/*` goes to `admin`, and everything else is a 404 at Caddy.
- The dashboard address (`ROUTERLM_DASHBOARD_ADDRESS`, default `:3001`) goes to `web`, whose forwarder (ADR 0089) reaches `admin`'s `/api` over the compose network. `/api` is never on a public address.
- By default both addresses are plain HTTP on ports, so the one-file install (ADR 0018) still works on `localhost` with no domain. Set to hostnames, Caddy serves them over HTTPS on 443 and gets their certificates itself. The development stack always uses the port addresses, and its Caddyfile must stay in step with `deploy/compose.yaml`'s.
- The gRPC control plane stays in the queue worker on a private address (ADR 0033).
- The role containers publish no host ports, and `TRUST_PROXY` on them is the compose network's fixed subnet (`ROUTERLM_SUBNET`), so only Caddy's `X-Forwarded-For` sets the client IP a Usage Log records (ADR 0032).

This reverses ADR 0025's rejection of a proxy in every install: that proxy only spread one role across CPUs, which `node:cluster` does on one port, while this one separates roles, which one port cannot. "Gateway" keeps meaning RouterLM as a whole; the component in front is the edge proxy.

## Considered Options

- Keep one `all` backend by default and ship the split as an opt-in compose file. Rejected: two install paths to document, release and smoke-test, and the default would keep the contention this decision removes.
- Every role loads every module and only the proxy routes keep traffic apart. Rejected: one wrong proxy rule would put the dashboard API on the public address.
- Split every feature module into a dashboard part and a provider part so `inference` loads no dashboard controller at all. Rejected for now: a large move across most modules for a guarantee the `/api` middleware already gives.
- Two edge proxies, one public and one internal. Rejected: the dashboard API already stays private because `web` reaches `admin` inside the compose network.
- Group the control plane with inference as "public" traffic. Rejected: it is low-volume management traffic from Integrations, closer to the dashboard than to inference, though it is public.
- Require hostnames and HTTPS. Rejected: a first try on a laptop or a VM without DNS would not start.
- nginx or HAProxy as the edge proxy. Rejected for now: both need a separate ACME setup, nginx needs buffering turned off and timeouts raised for SSE, and their throughput lead is noise next to upstream latency. HAProxy is the move if many inference replicas across hosts ever need finer balancing.

## Consequences

- Playground runs on `admin`, so `admin` keeps upstream egress and the routing code; operator testing never takes capacity from Customers.
- Caddy finds inference replicas through compose DNS (`dynamic a`), which its active health checks do not cover, so it balances them by least connections with passive checks only, and retries only a request it could not deliver.
- Each role runs its own process count (`INFERENCE_PROCESSES`, `ADMIN_PROCESSES`). Replicas per role (`--scale inference=N`) work but are not the default.
- Both roles hold the snapshot (ADR 0020), since API Keys and Integration Secrets are checked against it or Postgres (ADR 0078). Scheduled work is unaffected: it runs in the queue worker as BullMQ job schedulers.
- An existing install upgrades with the same `docker compose pull && docker compose up -d`, plus `--remove-orphans` to drop the old `backend` container; the network is recreated with the fixed subnet. Its own reverse proxy, if any, now points at Caddy's ports 3000 and 3001, or is replaced by Caddy with hostnames.
- The production smoke test checks the routing: `/v1` and `/integration/v1` reach their roles and `/api` is closed on the API port.
- No first-party Nest package covers role-based loading; it is a native dynamic-module choice in `AppModule`, like `ControlPlaneModule.overHttp()` (ADR 0001).
