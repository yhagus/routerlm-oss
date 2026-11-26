---
status: accepted
areas: [backend, tooling]
---
# `@/` alias imports, built with `nest build` on TypeScript 6

Imports that climbed out of a module (`../../../db/schemas/index.js`) were long and broke whenever a file moved. We decided (2026-11-15) that `@/*` maps to `src/*` through `paths` in `tsconfig.json`. An import that leaves its own module uses `@/` (`@/db/schemas/index.js`, `@/libs/...`). An import inside the same module stays relative (superseded by ADR 0037: no import climbs with `../`, inside a module either). Code that several modules share and that belongs to no module's domain lives in `src/libs/`, laid out like any other module (ADR 0007).

Typecheck, Bun (dev, Docker, `bun run src/...`) and Vitest (`resolve.tsconfigPaths`) read `paths` directly. The compiled output that CI builds and `start:prod` runs with Node does not, so the alias has to be rewritten at build time. Following ADR 0001, the build is `nest build`, which rewrites `paths` aliases (docs.nestjs.com, "nest build"). `nest build` needs TypeScript's programmatic compiler API, and TypeScript 7.0 doesn't ship it, so we moved from TypeScript 7.0.2 back to 6.

## Considered Options

- `tsc-alias` as a post-build step on TypeScript 7. Rejected: it adds a third-party build tool where a first-party one exists.
- Running production on Bun and dropping the Node build. Rejected: it changes how production runs just to fix import paths.
- Node subpath imports (`#/...`). Rejected: they have to start with `#`, and we wanted `@/`.

## Consequences

- When TypeScript 7.1 ships the compiler API, move back to TypeScript 7 and keep `nest build`.
- `web/` has its own TypeScript and Nuxt's own `@/` alias. This decision doesn't affect it.
