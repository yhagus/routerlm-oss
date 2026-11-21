# Integrations manage API Keys through one contract served over HTTP and gRPC, while inference stays HTTP

We want outside business applications, such as a SaaS that resells inference, to run on top of the gateway. Each one is an Integration that issues API Keys to its own Customers and reads their usage. gRPC was proposed for the whole link because it is faster than REST. For inference that gain is noise: a request waits hundreds of milliseconds to tens of seconds on the upstream, and JSON over HTTP costs microseconds to a few milliseconds. Customers also call through OpenAI and Anthropic SDKs, which only speak HTTP, so a gRPC-only gateway would need a translating hop in front of it, which is slower.

We decided that Customers call the inference endpoints directly, with their API Keys, over the HTTP Protocols the gateway already speaks. The Integration itself talks to a separate control plane that creates, updates, rotates and revokes its API Keys, lists the Models it may sell, and pulls its Usage Logs with a cursor. The control plane is one set of CQRS commands and queries with one `.proto` file as its contract, served by two thin adapters that must stay at parity:

- HTTP/JSON on the gateway's own port, under its own path prefix, using proto3's JSON mapping. This is the path for Integrations on the public internet, behind the TLS proxy the gateway already has.
- gRPC through `@nestjs/microservices` (`Transport.GRPC`, first-party per ADR 0001), started only when `CONTROL_PLANE_PORT` is set, and only in the queue worker (`src/worker.ts`), which is one process.

Each Integration authenticates with its own Integration Secret, issued from the dashboard, stored hashed, rotatable and revocable. An Integration sees only its own API Keys and Usage Logs. Error Captures stay operator-only, since they can hold request content and upstream details.

## Considered Options

- gRPC for inference as well. Rejected: no measurable gain, and Customers' SDKs cannot use it.
- The SaaS backend proxies every inference request to the gateway. Rejected: a second hop and a second stream on the hot path, and one more service that can fail.
- gRPC only for the control plane. Rejected: an Integration on the public internet would then need its own TLS proxy setup for gRPC; HTTP reuses the one the gateway already has.
- gRPC in every gateway process. Rejected: under Bun it is unverified whether an HTTP/2 server shares a port across `node:cluster` workers (ADR 0025), and the control plane does not need N processes.
- One static service token from the environment. Rejected: one gateway serves many Integrations, and each needs its own credential it can lose and have revoked alone.

## Consequences

- Bun's HTTP/2 server accepts but ignores some flood and reset protections, so the gRPC port is never published directly: it stays on a private network, or behind a TLS proxy that speaks h2c to the worker.
- Adding a control plane operation means a `.proto` change plus both adapters; a test covers each transport.
- A self-hoster who never creates an Integration sees no change: the HTTP routes answer 401 and no gRPC listener starts.
- Changes made through the control plane reach the gateway processes through the snapshot change notices (ADR 0020).
