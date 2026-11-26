# Imports carry no file extension or /index, and quotes are single

The backend is written only in TypeScript, but every import named a `.js` file (`@/db/schemas/index.js`, `./x.js`) that does not exist in the source. That came from `module: nodenext` in `tsconfig.json`, which makes TypeScript require the extension Node's ESM loader needs at runtime. Nothing here runs the compiled output on Node: development, tests, the Docker images and `start:prod` all run on Bun, and Vitest resolves through Vite. Both resolve extensionless imports. We decided (2026-11-26) that imports in `src/`, `tests/` and `scripts/` carry no file extension (`@/db/schemas/index`, `./x`, `@nestjs/core/helpers/execution-context-host`).

- `tsconfig.json` uses `module: esnext` with `moduleResolution: bundler`, which accepts extensionless imports and still reads package `exports`.
- `nest build` keeps rewriting the `@/` alias (ADR 0008) and emits extensionless relative imports, which `bun dist/main.js` resolves.
- `.oxlintrc.json` enables the `import` plugin with `import/extensions: ["error", "never"]`, so `bun run check` fails on any import that names an extension, package subpaths included.

A folder with an `index.ts` is imported by the folder (`./commands/handlers`, `@/db/schemas`), never by `/index`. `no-restricted-imports` (patterns `**/index` and `./index`) enforces it; the ADR 0007 handler ban also lists the folder forms (`@/*/commands/handlers`) so it still catches them.

Quotes are single (`singleQuote: true` in `.oxfmtrc.json` and `web/.oxfmtrc.json`), so `bun run format:check` fails on double quotes. The checks that read source text (`check:redis-keys`, `scripts/check-web-mirrors.ts`, the Dockerfile's `@/`-leftover guard) match either quote.

This supersedes the `.js` suffix in the examples of ADR 0008 and ADR 0037. Their rules stand.

## Considered Options

- Keeping `nodenext` and `.js`. Rejected: the source names files that only exist after a build, for a runtime we don't use.
- `.ts` extensions with `rewriteRelativeImportExtensions`. Rejected: TypeScript only rewrites relative specifiers, not the `@/` alias, so aliased imports would still break in `dist/`.

## Consequences

- `dist/` no longer runs on plain Node. Running production on Node would need a bundler or a move back to `nodenext`.
- Package subpaths are imported without an extension too, which only works when the package's `exports` maps the extensionless path (as `@nestjs/core` does with `"./*": "./*.js"`).
