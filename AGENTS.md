# LobakAI Architecture

LobakAI runs a Bun backend and a Vue dashboard.

## Repository layout

- `backend/` contains the Bun and Hono API server.
- `frontend/` contains the Vue and Vite dashboard.
- `backend/src/services/` holds typed product domains: `chat`, `providers`, `billing`, `media`, `platform`, `common`.
- `gitbook/` contains the published documentation site.

## Runtime

Run the backend on `127.0.0.1:20129` by default.

Run the frontend on `127.0.0.1:20130` by default.

Vite proxies API requests from the frontend to the backend.

The backend serves `/api/*`, `/v1/*`, `/v1beta/*`, `/responses`, and `/codex`.

The backend stores state in SQLite.

`BACKEND_DATABASE_PATH` selects the SQLite database path.

`DATA_DIR` selects the application data directory.

The `models` table holds the searchable model catalog (registry + custom + discovered rows). The provider registry seeds it on boot via `backend/src/services/providers/modelSync.ts`. Read models through `repos.models` or `backend/src/services/providers/modelCatalog.ts`, not the registry directly.

`GET /api/providers/:id/quota-summary` returns the aggregated quota across every active connection of a provider. It reads `quotaSnapshots` only. It never triggers an upstream fetch. Use it for page-level totals such as "Total Available" on the provider detail page. Per-connection bars still read `/api/usage/batch`.

## Development commands

Install workspace dependencies with `bun install`.

Start the backend with `bun run dev:backend`.

Start the frontend with `bun run dev:frontend`.

Check types with `bun run typecheck`.

Run tests with `bun run test`.

Build the dashboard with `bun run build`.

Tautological es considered harmful.

## Product service layout

`backend/src/services/` holds typed product code.

Edit it freely, but prefer fixing behavior in typed product code first.

Do not import `@/` or `open-sse/` bare specifiers from backend product source.

Import sibling domains through explicit relative paths.

## Documentation and response rules

Use ASD-STE100 Simplified Technical English.

Use active voice.

Keep each sentence within 20 words.

State one action or fact per sentence.

Use literal and unambiguous words.

## Testing Guidelines

- Tautological tests are considered harmful.
- Tests should be done when all tasks has been successfully. tldr; we completely finish the task, and then do a one session containing many tests, and start fixing if there are any failed tests, then run last tests. That way, we run tests much lesser.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
