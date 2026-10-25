# v1.6.0 (2026-10-26)

## Providers

- A custom provider can have a logo. Upload it in the "Add custom provider" form or in the Edit dialog. Select "Remove" to delete it.
- The logo is stored in the database. A database backup includes it.
- The detail page of a custom provider uses the same layout as other API key providers. Edit and Delete are in the page header.
- On a custom provider's detail page, "Import from /models" adds the models from the endpoint. "Add Model" adds one model with its capabilities.
- The Add API Key form of a custom provider no longer asks for a default model.
- The Providers list shows custom providers with their logo and connection status. "Test all" tests their connections.

# v1.5.0 (2026-10-24)

## Providers

- Added the OrcaRouter provider. Connect it with an OrcaRouter API key (`sk-orca-...`).
- OrcaRouter fetches its model list from the account. Embedding, image and video models are left out.
- On a provider's detail page, an "All Models / Only Free" filter shows next to the Thinking select. "Only Free" lists models whose id ends in `-free` or `:free`. The filter shows only when the provider has a free model.

## Dashboard

- A "What's new" button shows in the header after an update. It opens the change log for the running version.
- The Change Log dialog opens on one version. Select "Show all versions" to see the full history.

## npm package

- The command is now `rlm`. Start LobakAI with `rlm`, `rlm connect <url>` and `rlm show`. The `routerlm` command is removed. The package name stays `@ciwergrp/routerlm`.

## Releases

- Each version tag creates a GitHub release. Its notes come from the matching section of this change log.

# v1.4.0 (2026-10-24)

## Providers

- Removed the CodeBuddy CN and Dudul providers. CodeBuddy CLI is unaffected.
- Updated the Claude Code provider to match the 2.1.310 release (CLI version, bundled SDK version, and beta flags).

## Quota

- Quota lists longer than 5 items are now condensed. On a provider's detail page a "Show all" toggle reveals the rest.
- On Quota Tracker, each account pages through its quota items with left/right controls. The number of accounts is not limited.

## Vision Adapter

- The model picker now scopes by provider: pick a provider, then choose from its models, instead of typing the id by hand.

## Navigation

- Queue Jobs moved under the "Logs" group.
- Removed the "Free Tracker" item from the sidebar.

# v1.3.0 (2026-10-24)

## npm package

- Install with `npm install -g @ciwergrp/routerlm`, then start with `routerlm`. Bun ships with the package.
- The dashboard runs on port 20130 and the API on port 20129, as in Docker.
- `routerlm` takes the 9router options: `--port`, `--host`, `--no-browser`, `--log`, `--skip-update`, `--help` and `--version`.
- `routerlm connect <url>` points local CLI tools at a remote server. `routerlm show` prints their current config.
- Each version tag publishes the package to npm.

## Providers

- "Export API Keys" in the bulk actions menu downloads the selected API keys as a text file, one key per line.
- The ZenMux logo shows on the provider detail page.
- "Total Available" lists each currency on its own, such as "0 USD + 0.266 CNY", instead of adding them up.

# v1.2.0 (2026-10-19)

## Per-account concurrency

- Each account can set its own max concurrent requests. Empty means no limit.
- The account limit overrides the provider "Max in-flight" default.
- A full account sends new requests to the next account.
- When all accounts are full, the client gets 503 with `Retry-After`.
- Set the limit per row in Edit Connection, or on a selection with "Set Max Concurrent".

## Session affinity

- Each conversation and each API key gets a home account. This keeps upstream prompt caches warm.
- A full home sends one request to another account. The next request returns to the home.
- A home on cooldown or failed moves the conversation to the account that serves it.
- New conversations of one API key start on the home of that key.
- Round-robin now spreads conversations, not single requests.
- Each provider has a "Session affinity" switch. It is on by default.

## Proxy

- "Apply Proxy" applies to the selected accounts. With no selection, it applies to all accounts.
- "Apply Proxy" is also in the bulk actions menu.

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
