# Feature modules use CQRS with `@nestjs/cqrs` and a commands/queries/events folder layout

Feature modules used to put every operation in one `<module>.service.ts`, which grew long and mixed reads with writes. We decided (2026-11-15) that feature modules dispatch through `CommandBus`, `QueryBus` and `EventBus` from `@nestjs/cqrs` (first-party, ADR 0001), and lay out their folders like the example that docs.nestjs.com links to (`kamilmysliwiec/nest-cqrs-example`):

```
src/<module>/
  <module>.controller.ts
  <module>.module.ts
  commands/{handlers,impl}/   # <verb-noun>.command.ts, <verb-noun>.handler.ts, handlers/index.ts
  queries/{handlers,impl}/    # <noun>.query.ts, <noun>.handler.ts, handlers/index.ts
  events/{handlers,impl}/     # only when the module publishes events
  models/                     # types and domain helpers
  schemas/                    # zod request schemas, flat (no handlers/impl)
```

Each folder only exists when it has something in it. `api-keys` went first as the pilot. The other feature modules follow one at a time.

## Considered Options

- Keeping one service per module. Rejected: the services kept growing, and reads and writes were hard to tell apart.
- Full DDD layering (`domain/`, `application/`, `infrastructure/`, repository interfaces). Rejected: more indirection than a gateway this size needs. Handlers query Drizzle directly.

## Consequences

- More files per module: each operation has a command or query class, a handler and an entry in `handlers/index.ts`.
- Infrastructure modules (`config`, `db`, `redis`, `queue`, `snapshot`) keep their current layout. So do the inference hot path and its `protocols/*` adapters, so no bus dispatch is added to the code that serves a request. `playground` (one streaming endpoint that runs through inference), `auth` (sign-in and sessions) and `catalog` (seed tooling) keep their current layout for the same reasons.
- Inside a converted module, infrastructure files that other modules import (BullMQ producers and processors, scheduled jobs, ciphers, stores, auth providers) stay at the module root.
- `EventBus` runs in memory and loses events if the process dies. Work that must not be lost, such as Usage Log writes, stays on BullMQ.
- Providers that other modules use, such as `ApiKeyAuth`, stay plain injectable classes and are exported as before.
