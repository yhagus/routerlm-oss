## Agent skills

### Issue tracker

Issues live in GitHub Issues on yhagus/routerlm-oss (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Checks

Before reporting work done, run `bun run check` (and `cd web && bun run check` for web changes), plus `bun run test:e2e:docker` for backend changes.

## Implementation policy

### Backend: NestJS first-party first

Before implementing any capability in the backend (config, database, caching, queues, scheduling, auth, validation, logging, health checks, and so on), look it up on https://docs.nestjs.com (through Context7, or by fetching the page). Use the first option that exists:

1. A first-party package: an `@nestjs/*` package documented on docs.nestjs.com, used the way its docs page shows.
2. A pattern docs.nestjs.com documents for a third-party library.
3. A native implementation, wrapped in a normal Nest module or provider.

State the lookup result in the plan, and in any subagent brief: either "first-party: `@nestjs/<name>`" or "none found, implementing natively". Community Nest wrappers the docs don't mention get no preference.

Context7's index can lag behind the live docs. If a Context7 result conflicts with the installed version or looks outdated, fetch the docs.nestjs.com page directly and trust that. Check published versions with `npm view <package> version`.

If a first-party package lacks a feature or has a bug, do not switch to a standalone implementation silently. Ask the user first, then record the reason in an ADR. Background: `docs/adr/0001-prefer-nestjs-first-party-packages.md`.

### Backend: CQRS layout for every module

Every module in `src/` uses `@nestjs/cqrs`. Only the `<module>.module.ts` and controllers sit at the module root. Everything else goes into role folders: `commands/{handlers,impl}`, `queries/{handlers,impl}`, `events/{handlers,impl}`, `models/`, `schemas/`, `providers/`, `jobs/`, `filters/`, `middleware/`, `decorators/` and `data/`. `src/api-keys/` is the reference. See `docs/adr/0007-cqrs-folder-layout-for-every-module.md`.

### Backend: imports and shared code

An import that leaves its own module uses the `@/` alias for `src/` (`@/db/schemas/index.js`). An import inside the same module stays relative. Tests import from `@/` too. Code that several modules share and that belongs to no module's domain goes into `src/libs/`, laid out like any other module. Shared injectables are registered in its global `LibsModule`. The build is `nest build`, which rewrites the alias; it needs TypeScript 6 until 7.1. See `docs/adr/0008-at-alias-imports-and-typescript-6-for-nest-build.md`.

### Web: Nuxt first-party first

In `web/`, apply the same principle: prefer official `@nuxt/*` modules and patterns documented on https://nuxt.com/docs over hand-rolled ones.
