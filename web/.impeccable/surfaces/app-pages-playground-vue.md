---
version: 1
slug: "app-pages-playground-vue"
primary_target: "app/pages/playground.vue"
related_targets: ["app/lib/playground.ts","app/assets/css/main.css"]
---

# Playground

Mode: Operate. Platform engineers smoke-test a Model: does a request reach the expected Route and Provider Account, and what do tokens, Cost and errors look like. Inherits DESIGN.md ("The Quiet Control Plane"); no system change. Code-led, structure confirmed in shape.

## Direction contract

THESIS: A test bench, not a chat app. Before sending, the page shows what will happen (the Route chain); after, each answer carries its receipt. Refuses the empty chat window with a centred icon.

OWN-WORLD: DESIGN.md neutrals; white panels on paper gray; tabular receipts; provider marks; state colour only for unusable Routes and failures.

STORY: Pick a Model, see its Routes in fallback order and the Parameter Policy defaults, fire a starter or own message, read Route, account, tokens and Cost under the answer; copy the exact request as curl or TypeScript.

FIRST VIEWPORT: Full-width Model bar (picker, active-parameter summary, session totals, Code and Settings) above a full-height chat panel whose empty body is the Route chain plus starters; composer pinned at the panel bottom; settings rail at >=1100px, sheet below.

FORM: test bench, item 1 of the shaped list. seed: none (roll skipped: structure confirmed with the user in shape; disclosed)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
