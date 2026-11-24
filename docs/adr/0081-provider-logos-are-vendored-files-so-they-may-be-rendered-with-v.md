# Provider logos are vendored files, so they may be rendered with v-html

`ProviderLogo.vue` renders a Provider's mark as raw SVG with `v-html`. Each mark is a file in `web/app/assets/provider-logos`, named after the Provider's `logo` key (`web/app/lib/providerLogos.ts`), so adding a logo means dropping in a file.

We decided that logos come only from vendored files in the repository, never from user input or a URL an operator supplies. That is what makes `v-html` safe here: it renders nothing untrusted.

## Consequences

- A feature that lets an operator upload or link a logo must not reuse the `v-html` path; it needs sanitising or an `<img>` tag.
- `LABEL_OVERRIDES` names marks whose file title isn't how the dashboard writes the company.
