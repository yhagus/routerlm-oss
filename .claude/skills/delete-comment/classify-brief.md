# Comment classification brief

Repo: the routerlm-oss checkout (NestJS backend in `src/`, feature tests in `tests/`, Nuxt dashboard in `web/`).
The project is deleting every code comment. Your job is to classify the comment blocks in ONE partition file and draft what has to be preserved. You do not edit the repo: read only, and write only your result file.

## Input

Your partition file is a JSON array of blocks: `id`, `at` (file:line or file:start-end), `trailing` (true when the comment sits after code on the same line), `comment` (verbatim text), `codeAfter` (the 4 source lines after the comment). Classify from that; open the file only when the context isn't enough to judge.

Before starting, skim `GLOSSARY.md` and the titles of `docs/adr/*.md` (`ls docs/adr`), and read the ADRs your partition's comments cite (many comments say "(ADR 0014)").

## Categories (exactly one per block)

- `tautology`: repeats what the code already says: its name, signature, type, the obvious behaviour, a section header (`// Settings`, `/* Buttons */`), a field description that restates the field name. Also: a comment whose content is already fully recorded in an existing ADR or GLOSSARY.md (say which in `reason`).
- `stale`: references code, files, symbols, behaviour or plans that no longer match the code. Verify: grep for every file path or symbol it names; check the claim against the code it sits on. Only call it stale when you checked.
- `excuse`: explains away a hacky or knowingly-wrong implementation: a workaround, a "for now", a TODO, a known limitation papered over, duplicated logic justified by a comment, a cast or escape hatch justified in prose, a "keep in sync with X by hand". The implementation, not the comment, is the problem, so it needs an issue.
- `decision`: documents an important, non-obvious decision that a future reader would otherwise "fix": a deliberate deviation from the obvious path, a constraint not visible in the code (a Provider's API quirk, a security property, an ordering/concurrency guarantee, a wire-format rule), a rejected alternative. Apply the ADR bar: hard to reverse, OR surprising without context, AND the result of a real choice. A small local "why" whose loss would cost a reader a minute is `tautology`, not `decision`.
- `keep`: load-bearing, deletion would break something (a tool parses it, a compiler directive). Should be extremely rare; explain in `reason`.

When unsure between tautology and decision, ask: "if this comment vanished, would a competent engineer likely make a wrong change?" Yes → decision.

## ADR drafts (for `decision` blocks)

Group decision blocks that are facets of the same decision into one ADR draft. For each draft, either:
- `existing: "00NN"` when an existing ADR already covers this decision: set `alreadyRecorded: true` if the ADR already says what the comment says (nothing to add), else give `append`: one or two sentences to add to that ADR, in its voice.
- or a new ADR: `title` (the decision as a sentence, like the existing titles, e.g. "Usage Resets are stored, and their list is fetched again only when the count disagrees") and `body` in Markdown following this repo's style (read docs/adr/0041-*.md and 0014-*.md): a context paragraph, a "We decided ..." paragraph with the why, and `## Considered Options` / `## Consequences` only when the comments give real material for them. Use GLOSSARY.md vocabulary (capitalised domain terms). Name the code it governs by symbol or file path so a reader can find it. Don't invent rationale the comments don't support; you may read the code to state the decision accurately.

Do not number new ADRs; the main thread numbers them.

## Issue drafts (for `excuse` blocks)

Group excuse blocks that point to the same hacky implementation into one issue draft: `title` (imperative, glossary vocabulary, under 80 chars) and `body` in Markdown with sections `## Problem` (what the implementation does and why it's hacky, citing file:line), `## What the deleted comment said` (quote it), `## Suggested direction`, `## Acceptance criteria` (checkbox list). Before drafting, check `gh issue list --state open --limit 200 --json number,title` once; if an open issue already covers it, set `existingIssue: <number>` instead of a body.

## Output

Write ONE file: `<work-dir>/results/<partition>.json` (the path is in your prompt) with this shape:

```json
{
  "blocks": [ { "id": "c0001", "category": "tautology", "reason": "≤ 15 words", "adr": "key-or-omit", "issue": "key-or-omit" } ],
  "adrs":   [ { "key": "kebab-slug", "existing": "0014", "alreadyRecorded": false, "append": "…", "title": "…", "body": "…" } ],
  "issues": [ { "key": "kebab-slug", "title": "…", "body": "…", "existingIssue": 12 } ]
}
```

Every input id must appear exactly once in `blocks`. Every `decision` block names an `adr` key, every `excuse` block an `issue` key. Validate the file with `jq` before finishing (ids complete, keys resolve).

Your final message: only the counts per category, the number of ADR drafts (new / append / already recorded), the number of issue drafts, and anything surprising (for example a `keep` block, or a comment that turned out load-bearing). No file dumps.
