# AI Elements Vue and Tailwind CSS for the web app

The Playground needs the parts every LLM chat surface needs: a conversation that sticks to the bottom while an answer streams, Markdown with highlighted code, a collapsible reasoning block, a composer with image attachments and a stop button, and a token-usage card. ADR 0001 asks `web/` to prefer official `@nuxt/*` modules, and Nuxt UI ships chat components. We chose AI Elements Vue (the community Vue port of Vercel's AI Elements, built on shadcn-vue) instead, at the maintainer's request: it covers more of the LLM-specific parts (reasoning, usage, code blocks, prompt attachments), and its components are copied into the repo, so they can be changed where they don't fit.

AI Elements Vue requires Tailwind CSS with shadcn-vue's CSS variables. The web app had UnoCSS installed but used none of its utilities, so we replaced it with Tailwind CSS v4 (`@tailwindcss/vite`, as shadcn-vue's Nuxt guide shows) rather than running two utility engines.

## Considered options

- Nuxt UI chat components: first-party under ADR 0001, but fewer LLM-specific parts and a component library that brings its own design system.
- Tailwind only for the vendored components, next to UnoCSS: two engines generating utilities from the same sources.
- UnoCSS `preset-wind4` compiling the components' classes: shadcn-vue doesn't support UnoCSS, so classes that don't compile would fail silently.

## Consequences

- `app/assets/css/main.css` is the Tailwind entry. The dashboard's own stylesheet, `dashboard.css`, is imported into the `components` layer, so utilities on vendored components win where both set a property. To restyle a vendored component, pass Tailwind classes through its `class` prop rather than writing a dashboard rule.
- shadcn-vue's colour names (`--color-primary`, `--color-muted`…) are mapped in `@theme inline` onto the DESIGN.md tokens. Its own variables (`--primary`, `--muted`…) are not defined globally because those names already mean other things here. `vue-stream-markdown` reads them raw, so they are mapped only on its `.stream-markdown` root.
- `dark:` follows the theme switch (`data-theme`) and the system setting, through a custom variant.
- `components/ui/` and `components/ai-elements/` are vendored code: oxlint ignores them, Nuxt doesn't auto-import them (import them explicitly), and local fixes to them (types for the installed `ai` version) are re-checked when a component is re-added from the registry.
- The Playground keeps its own transport (`lib/playground.ts`): the backend streams Chat Completions events plus a summary event, not the AI SDK message stream, so the elements are used for display only. Costs shown are the gateway's, never the client-side price estimates some elements can compute.
