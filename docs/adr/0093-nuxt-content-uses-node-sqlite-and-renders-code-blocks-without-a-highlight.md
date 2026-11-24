# Nuxt Content uses node:sqlite and renders code blocks without a highlight theme

The docs use `@nuxt/content` (`web/nuxt.config.ts`).

We decided to set `experimental.sqliteConnector: "native"`, which uses `node:sqlite` so the build needs no native addon; under Bun (the dev image) `@nuxt/content` falls back to `bun:sqlite`. We also set `build.markdown.highlight: false`: plain code blocks take the theme's ink, because a single highlight theme is unreadable in the other colour scheme.
