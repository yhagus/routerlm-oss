# v1.1.0 (2026-10-19)

## Event API keys

- An event key has a name and no secret.
- Each event has a public link at `/event/<id>`.
- A visitor of the link enters a name and gets an own API key.
- Each participant name is unique in an event. Case does not matter.
- Participant keys use the access policy of the event: combo and model access, limit, concurrency, connection pins, and features.
- The limit and the concurrency apply to each participant key.
- Usage is counted per participant key.
- A new event detail page shows the public link and the participants.
- Pausing an event closes the link and disables all participant keys.
- Deleting an event deletes all participant keys.
- The draft, submitted, and revoked states are removed.

## Upgrade

- Existing event keys become private keys. Their secret and configuration do not change.

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
