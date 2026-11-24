# Client docs examples are written against a placeholder URL that tests run and the page swaps

The public client docs (`web/content/docs`, `web/content/docs-id`) contain request examples that must keep working.

We decided that every example is written with `DOCS_PLACEHOLDER_URL` (`https://gateway.example.com`, in `web/app/composables/useGatewayUrl.ts`). `tests/docs/client-examples.test.ts` runs the examples against that placeholder, so the Markdown keeps it, and the page replaces it at render with `runtimeConfig.public.gatewayUrl` or the host the browser opened the docs on, at the gateway's default port.
