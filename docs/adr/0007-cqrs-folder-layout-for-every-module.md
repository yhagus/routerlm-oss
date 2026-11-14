# Every backend module uses CQRS with `@nestjs/cqrs` and a role-based folder layout

Modules used to put every operation in one `<module>.service.ts`, which grew long and mixed reads with writes. We decided (2026-11-15) that modules dispatch through `CommandBus`, `QueryBus` and `EventBus` from `@nestjs/cqrs` (first-party, ADR 0001). Their folders follow the example that docs.nestjs.com links to (`kamilmysliwiec/nest-cqrs-example`). Every module in `src/` uses this layout, including infrastructure modules and the inference path:

```
src/<module>/
  <module>.module.ts          # the only files at the module root:
  *.controller.ts             #   the module and its controllers
  commands/{handlers,impl}/   # <verb-noun>.command.ts, <verb-noun>.handler.ts, handlers/index.ts
  queries/{handlers,impl}/    # <noun>.query.ts, <noun>.handler.ts, handlers/index.ts
  events/{handlers,impl}/     # only when the module publishes events
  models/                     # types, pure domain helpers, plain data-access functions
  schemas/                    # zod schemas and Drizzle tables, flat
  providers/                  # injectables that aren't handlers: auth providers, stores, ciphers, clients, state holders
  jobs/                       # BullMQ producers and processors, scheduled jobs
  filters/, middleware/, decorators/   # Nest enhancers
  data/                       # static data files
```

Each folder exists only when it has something in it, and a spec file sits next to the file it tests. Entry points (`main.ts`, `worker.ts`, `seed.ts`) and the root `app`/`worker` modules sit directly in `src/`. Folders that group code by protocol, such as `inference/protocols/<protocol>/`, keep that grouping.

## Considered Options

- Keeping one service per module. Rejected: the services kept growing, and reads and writes were hard to tell apart.
- Full DDD layering (`domain/`, `application/`, `infrastructure/`, repository interfaces). Rejected: more indirection than a gateway this size needs. Handlers query Drizzle directly.
- Converting only the dashboard feature modules and leaving infrastructure and inference as they were. Rejected by the maintainer: one layout everywhere is easier to navigate than two.

## Consequences

- More files per module: each operation has a command or query class, a handler and an entry in `handlers/index.ts`.
- Inference requests go through `CommandBus` (`RunInferenceCommand`). Dispatching through the bus is one map lookup, which is negligible next to the upstream call.
- A handler shares logic with another handler in the same module through plain functions in `models/`, not through the bus. Another module reaches a module's operation by dispatching its command or query.
- `EventBus` runs in memory and loses events if the process dies. Work that must not be lost, such as Usage Log writes, stays on BullMQ (`jobs/`).
