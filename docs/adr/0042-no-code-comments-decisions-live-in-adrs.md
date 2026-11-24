# No code comments: decisions live in ADRs, the code explains itself

Comments drifted from the code they described, restated names and types, and let a workaround pass review because a paragraph explained it away; agents then copied the workaround as precedent. We decided that the code carries no comments. A name, a type or a test says what a comment said; a decision that is important and non-obvious goes into an ADR here; a known shortcut becomes a GitHub issue instead of a comment beside it.

The rule is `routerlm/no-comments` (`scripts/lint/no-comments.mjs`), an oxlint JS plugin run by `bun run lint` at the root and in `web/`. Directive comments that tools read (`@ts-expect-error`, `eslint-disable`, `oxlint-disable`, `@vue-ignore`, `#__PURE__`) are not counted.

## Considered Options

- Banning only new comments by review. Rejected: review is where the explained-away workarounds got through.
- Deleting every comment in one change. Rejected: some comments are load-bearing until their replacement exists (the mirror markers that `scripts/check-web-mirrors.ts` reads), and an all-or-nothing change stalls.

## Consequences

- The ban is a ratchet. `comment-baseline.json` holds how many comments each file may still have. A file with more fails the lint; a file with fewer also fails until `bun run comments:baseline` lowers its entry, so the count only moves down. The script refuses to raise an entry unless passed `--allow-growth`, which a reviewer should question.
- Vendored components (`web/app/components/ui/`, `web/app/components/ai-elements/`) are outside the rule, as they are outside the web lint. CSS and Vue `<template>` comments are outside what oxlint parses, so the rule does not see them; the `/delete-comment` skill sweeps them by hand.
- Running the sweep again is the `/delete-comment` skill, kept in the maintainer's global Claude Code skills (`~/.claude/skills/delete-comment/`).
