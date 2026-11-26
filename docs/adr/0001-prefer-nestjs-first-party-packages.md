---
status: accepted
areas: [backend]
---
# Prefer NestJS first-party packages over standalone implementations

The backend builds every capability the NestJS way before anything else: first a first-party package (an `@nestjs/*` package documented on docs.nestjs.com), then a pattern docs.nestjs.com documents for a third-party library, and only when neither exists a native implementation wrapped in a normal Nest module or provider. We decided this after the database setup was first built as a hand-rolled Drizzle module reading `process.env` directly, although `@nestjs/drizzle` and `@nestjs/config` exist; standalone code like that drifts from the docs, duplicates lifecycle handling Nest already provides, and is harder for the next contributor (human or agent) to recognise.

## Consequences

- Some first-party packages are young (`@nestjs/drizzle` 0.0.2, `@nestjs/mcp` 0.0.4). We still use them. Working around a gap or bug with a standalone implementation needs the maintainer's approval first and a new ADR recording why.
- Community Nest wrappers that docs.nestjs.com does not mention get no preference; they are judged like any other dependency.
- Tools that run outside Nest's DI (for example `drizzle.config.ts` for drizzle-kit) read `process.env` directly.
- `web/` follows the same principle with official `@nuxt/*` modules and documented Nuxt patterns.
