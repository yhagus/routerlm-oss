---
name: delete-comment
description: Sweep the codebase's remaining code comments: classify each one, move decisions into ADRs, file issues for excused hacks, delete the rest and ratchet the comment baseline down.
disable-model-invocation: true
---

Comments are banned by `routerlm/no-comments` and ratcheted down per file by `comment-baseline.json` (ADR 0042). This skill is one ratchet turn: every comment the baseline still allows gets a verdict, and each verdict has one fate:

| Verdict     | Fate                                                      |
| ----------- | --------------------------------------------------------- |
| `tautology` | deleted                                                   |
| `stale`     | deleted                                                   |
| `excuse`    | deleted, and a GitHub issue to fix the hacky code         |
| `decision`  | deleted, and moved into an ADR in `docs/adr/`             |
| `keep`      | stays: load-bearing (a tool reads it), with a follow-up   |

Pick a work directory outside the repo (the session scratchpad), called `$WORK` below. An argument narrows the sweep to paths: apply it by deleting the other entries from `$WORK/parts/` before step 2.

## Steps

1. **Inventory.** On a branch off `main`, run `bun .claude/skills/delete-comment/inventory.ts $WORK`. It lists every comment with oxlint's parser (plus CSS and Vue `<template>` comments, which oxlint doesn't parse), groups consecutive `//` lines into blocks with ids, sets aside functional ones (directives, the mirror markers `scripts/check-web-mirrors.ts` reads), and writes `$WORK/inventory.json` and one `$WORK/parts/p<N>.json` per ~450 blocks. Done when it prints the totals.

2. **Classify.** Dispatch one classifier subagent per partition, all in one message, on a cheaper model (Sonnet), read-only, each told the brief path (`.claude/skills/delete-comment/classify-brief.md`), its partition file and `$WORK/results/p<N>.json` as its output. Done when every partition has a result file in which every input id appears once and every `decision` / `excuse` names an `adr` / `issue` key that resolves; check with `jq`, and send a fresh agent the gaps.

3. **Review the verdicts.** Read every `decision`, `excuse`, `stale` and `keep` verdict with its reason. Demote a decision that fails the ADR bar (hard to reverse or surprising, and a real trade-off) to `tautology`; promote a "tautology" whose reason describes a workaround to `excuse`. Merge ADR and issue drafts that two partitions wrote about the same thing. Done when each draft maps to one decision or one hack.

4. **Write the ADRs.** Number new ones after the highest in `docs/adr/`, in the repo's ADR voice (`docs/adr/0041-*.md`); fold each `append` into its ADR. Done when every `decision` block is covered by an ADR file on disk.

5. **File the issues.** Confirm the target with `gh repo view --json nameWithOwner`, then `gh issue create` each issue draft with the `needs-triage` label (see `docs/agents/issue-tracker.md`). Done when every `excuse` block maps to an issue number.

6. **Delete.** Run `bun .claude/skills/delete-comment/apply.ts $WORK`. It removes every comment whose verdict is not `keep`, whole lines for own-line comments, and collapses the blank lines left behind. Then `bun run format` at the root and in `web/`.

7. **Ratchet and check.** `bun run comments:baseline` lowers the baseline; it must never need `--allow-growth` here. Then the checks in `AGENTS.md` for both apps: `bun run check`, `bun run test:docker`, `cd web && bun run check`. A deletion that breaks a check is a comment the code leaned on: restore it with verdict `keep` and file an issue. Done when every check is green.

8. **Commit**, one commit per kind (`docs(adr): ...`, `refactor: delete code comments ...`, `chore(lint): ratchet comment baseline`), and report: verdict counts, ADRs written, issues filed, lines removed (`git diff --shortstat main`), and comments left in the baseline.
