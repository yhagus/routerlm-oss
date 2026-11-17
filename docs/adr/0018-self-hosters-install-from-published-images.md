# Self-hosters install from published images, not from a clone

Installing meant cloning the repo and running the development compose stack: source mounted as volumes, `bun --watch` and `nuxt dev` in production, and upgrades by `git pull`. We decided that a tagged release publishes two images to GHCR (`routerlm-backend` for the API, the worker and the one-shot migrate, and `routerlm-web` for the built Nuxt app), multi-arch, tagged from the git tag (`2.1.0`, `2.1`, `2`, `latest`). Each GitHub Release attaches a `compose.yaml` (kept in the repo as `deploy/compose.yaml`) that pins its own version, so an install is a download of one compose file and an `.env` followed by a plain `docker compose up -d`, and an upgrade is a change of `ROUTERLM_VERSION` followed by `docker compose pull`. The development compose stack stays for contributors.

## Considered options

- Keep the clone install and only harden the dev compose: production would still run watchers and dev servers, and every self-hoster would need the full source tree and a build.
- Have the compose file follow `latest`: a plain `docker compose pull` could jump a major version and its breaking changes without the operator choosing to.
- One image per service (backend, worker, migrate): three images built from the same code, with nothing to gain.

## Consequences

- A release is cut by pushing a `vX.Y.Z` tag: the workflow runs CI, checks the tag against both `package.json` versions, smoke-tests `deploy/compose.yaml` against the fresh images, pushes them, then creates the GitHub Release from the CHANGELOG section. An image never ships from a red commit, and a Release never points at an image that does not exist.
- Migrations run through the `drizzle-orm` migrator from the backend image, so `drizzle-kit` and the other devDependencies stay out of it.
- The production stack keeps the project name `routerlm-oss` and the dev stack's service and volume names, so an existing clone install switches by stopping the dev stack and starting `compose.yaml` in the same folder with the same `.env`: its Postgres and Redis volumes are reused. A clone in a differently named folder sets `COMPOSE_PROJECT_NAME`. The price is that new installs are named `routerlm-oss` too, and running both stacks on one machine needs `-p` with another name.
- `POSTGRES_PASSWORD` has no default in production, so a migrated install must set it to the password its volume was created with (`routerlm` unless changed).
- The production file is not at the repo root, because a root `compose.yaml` would take precedence over the dev `docker-compose.yml`.
- TLS and a reverse proxy are the operator's job; the stack only publishes the gateway and web ports.
