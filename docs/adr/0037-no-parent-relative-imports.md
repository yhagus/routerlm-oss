# No parent-relative imports

ADR 0008 moved imports that leave a module to the `@/` alias but kept relative paths inside a module. With the CQRS layout (ADR 0007), most of those were still parent-relative (`../../models/x.js` from `commands/handlers/`), and they broke whenever a file moved between role folders, the same way cross-module paths had. We decided (2026-11-23) that no import in `src/`, `tests/` or `scripts/` climbs with `../`:

- Code in `src/` is imported through `@/` (`@/settings/models/private-upstreams.js`), from inside its own module too.
- Code in `tests/` is imported through `@tests/`, which `tsconfig.json` `paths` maps to `tests/*` (`@tests/support/test-app.js`). Vitest reads it through `resolve.tsconfigPaths`. `tsconfig.build.json` excludes `tests/`, so `nest build` never sees it.
- A same-folder import (`./x.js`) stays relative. It never climbs, so it survives moving the folder. It also keeps `<module>.module.ts` importing `./commands/handlers/index.js` without matching the cross-module handler ban from ADR 0007.

`.oxlintrc.json` (`no-restricted-imports`, patterns `../*` and `../**`) enforces this, so `bun run check` fails on a new `../` import. File paths built with `new URL("../x", import.meta.url)` are not imports and are not affected.

This supersedes the "an import inside the same module stays relative" part of ADR 0008. The rest of 0008 (the `@/` alias and `nest build` on TypeScript 6) stands.

## Considered Options

- Keeping ADR 0008's rule (relative inside a module). Rejected: `../../` paths inside a module broke on moves just like cross-module ones, and the rule wasn't enforced, so it was easy to misremember.
- Banning every relative import, `./` included. Rejected: same-folder imports don't break on moves, and rewriting a module's own handler imports to `@/` would trip the ADR 0007 handler ban.
- Leaving `tests/` exempt. Rejected: one rule with no exceptions is easier to follow and to lint.

## Consequences

- Import lines inside a module are longer, since they name the module (`@/settings/...` from within `src/settings/`).
- Moving a file only breaks the imports of that file's own `./` neighbours and the `@/` paths that name it, which a search finds.
