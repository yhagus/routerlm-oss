# v1.0.0 (2026-10-17)

First LobakAI release.

## Branding

- Rename the product to LobakAI.
- Add the animated LOBAK logo (a red radish) and a matching favicon.
- Use the `lobak` prefix for internal headers and the CLI token.
- Write the provider name `lobakai` into CLI tool configs.

## Data

- Store data in `~/.lobakai` by default.
- Keep using the data folder of an earlier install when `~/.lobakai` does not exist.

## Architecture

- Run a Bun and Hono backend with a Vue and Vite dashboard.
- Use one Bun workspace lockfile for backend and frontend dependencies.
- Serve agent skill files from the dashboard at `/skills/`.
- Remove the npm self-update. `GET /api/version` returns the running version only.

## Providers

- Show providers in a dense directory view. The card view stays available.
- Let users choose the ID of a custom provider.
- Resolve the custom provider type from the stored node, not from the ID prefix.

## Privacy

- Mask every address in a forwarded IP chain on the public stats page.
- Mask IPv6 addresses. Hide values that are not an IP address.
