---
version: 1
slug: "app-layouts-docs-vue"
primary_target: "app/layouts/docs.vue"
related_targets: ["app/components/DocsPage.vue","app/pages/docs/[...slug].vue"]
---

# Surface brief: public client docs (/docs/**, /id/docs/**)

## Scope and mode
Read. Public client documentation, English and Indonesian, 9 pages each. Layout `app/layouts/docs.vue`, page `app/components/DocsPage.vue`, Docs* components, a docs-only stylesheet. The docs share the operator dashboard's design system; DESIGN.md applies in full, with the docs-specific parts in its Docs Surface section.

## Audience and job
Client developers with no dashboard login, arriving from search or a link for one endpoint; they read as reference, copy a request, leave. Operators need a way back to the dashboard. Success: endpoint, request example and the values to change are visible in the first viewport.

## Constraints
Every fact comes from content/docs and content/docs-id; no invented field tables or claims. Revision is the web app's real version. Light and dark themes via the shared `routerlm-theme` switch. Search via @nuxt/content `queryCollectionSearchSections` (first-party). Interface text in both languages through `docsMessages`.

## Direction contract
THESIS: Each endpoint is documented like a component datasheet on one white sheet: a title block, numbered sections and captioned figures. Same theme as the dashboard, its own structure: a public surface for client developers, not a page of the control plane. It refuses the category's three-column docs with an indigo accent and dark code panels, and refuses the dashboard's floating glass shell.
OWN-WORLD: No palette or faces of its own: the dashboard's tokens, Plus Jakarta Sans, JetBrains Mono for code and literal values only, and the 6–18px shape family (DESIGN.md). Docs-specific: the structure (full-width header, flat contents column, one sheet per page, recessed figures, tables and pager) and a compact reading ramp (prose 15px/1.6 at 72ch, lede 16px, h2 20px, h3 15px, title 28px).
STORY: The reader sees where they are (page 03 of 09, numbered contents), finds the endpoint in the title block, copies the typical request figure, and reads the numbered sections for detail; the pager at the foot of the sheet carries them to the next page.
FIRST VIEWPORT: A full-width 56px header on solid paper: brand, Docs chip, Client API and 03/09 left; the search field centred; EN / ID segmented, theme icon button, Sign in or Dashboard right. Below, a flat contents column (220px) on the canvas, numbered 01–09, the current page lifted like a segmented thumb with its sections on a hairline guide. Beside it one white 18px sheet: the 28px title and description, a ruled row of data cells (ENDPOINT, PAGE, REV, Copy page), the lede, then numbered section 1 with its recessed code figure (segmented curl/TypeScript tabs, Copy, caption FIG. 03-1) across the sheet width, with section 2 in view. Phones: the contents become a drawer that takes the settings; the sheet runs edge to edge.
FORM: Component datasheet structure (originally position 1 on the ordered list, seed:bcba8b9310cd5afb), carried by the dashboard's shared theme at the user's decision, in a structure distinct from the dashboard's shell.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: the header's page counter and the contents' nested section numbers track the reader's position as they scroll (current section turns ink); copying a figure flips its Copy button to Copied.
Reference composition: .impeccable/mocks/decision/model-pick.html
