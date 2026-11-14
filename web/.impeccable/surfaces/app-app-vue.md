---
version: 1
slug: "app-app-vue"
primary_target: "app/app.vue"
related_targets: ["app/pages/providers.vue","app/pages/routing.vue","app/pages/usage.vue","app/pages/api-keys.vue"]
---

# RouterLM Operations Console

## Job and audience
Platform operators use the authenticated console during production operation of an LLM routing gateway. The shared console gives them one fast health-and-control view across routing, providers, usage, and API keys. Mode: Operate.

## Outcome and proof
The console must help an operator identify a production issue, understand its scope, and move directly to the relevant control or detail view. Proof is current operational data: provider and route status, request volume, latency, errors, fallbacks, token counts, cache activity, and key status.

## Direction contract
THESIS: Run the console like a live operations board: fixed navigation, disciplined rows, clear time context, and state changes that remain visible rather than disappearing.
OWN-WORLD: Apple-clean neutrals: grouped gray canvas (#f5f5f7 / near-black), white or #1c1c1e cards with soft hairlines and 18px corners, a floating glass sidebar inset from the window, glass only where content passes behind (topbar, popovers, toast). 8px controls after Oil UI: a rainbow primary button after Inspira UI (white fill and dark text in both themes, a 1.5px spectrum edge and a soft blurred spectrum glow underneath, drifting slowly over 7s, 10px corners); the spectrum is an edge/glow accent only, never a fill; outlined secondary buttons. Never use green, purple, blue, brown/stone/taupe, coral/peach/orange tints, or (in light mode) black/graphite as a background color (buttons, logo mark, toast, chips, tags, tiles, bars, selection); those hues appear only in icons and status text. Lucide icons instead of colored dots or unicode arrows. No coral, peach, or navy. Plus Jakarta Sans throughout.
STORY: The operator sees the gateway's current state first, scans the route rows and provider availability, then drills into providers, usage, or keys without losing the active production context.
FIRST VIEWPORT: A persistent left rail and top utility bar frame a dashboard with a title and time-range control, four health metrics, a live route table with provider chains and status, and a two-column lower band for provider availability and the latest event.
FORM: Operations Board composition, chosen from the surface roll; seed:0ea8deceb0f10306.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Scope and boundaries
Production-ready authenticated console covering routing overview, provider management, usage analytics, and API key management. Include responsive desktop and tablet behavior and the material states listed below. Do not invent billing, team administration, deployment workflows, unsupported provider claims, or routing policies.

## States and ranges
Support multiple providers and routes; healthy, degraded, disconnected, disabled, and fallback states; high-volume requests and tokens; input, output, cached, and total token distinctions; latency percentiles, error rates, and cache-hit rates; active, expiring, revoked, and never-used keys; loading, empty, partial-data, permission-denied, validation-error, failed-test, and success states; long labels without clipping.

## Interaction and layout
Desktop favors dense scanning; tablet collapses navigation and stacks detail regions while preserving hierarchy. Filters, date ranges, provider/model selectors, and table sorting persist within a section. Destructive actions confirm consequences. Changes show pending, success, and failure feedback near the affected control. Tables support density, row expansion or detail drawers, and clear pagination or time-window boundaries. Charts expose exact values through tooltips or accessible summaries.

## Constraints and open decisions
Nuxt 4, Vue 3, and UnoCSS. Reusable shell, navigation, status, table, filter, chart, detail, and feedback patterns should be designed as a coherent system. Specific provider integrations, permissions model, retention windows, alerting behavior, and localization requirements remain open.
