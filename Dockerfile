# Images for the NestJS backend and its queue worker (run on Bun).
#   base, backend, worker: development, used by docker-compose.yml with the
#     source mounted as a volume.
#   production: the published image (ghcr.io/yhagus/routerlm-backend). One
#     image serves the API (default command), the worker (`bun dist/worker.js`)
#     and the one-shot migrate (`bun dist/migrate.js`); see deploy/compose.yaml.
FROM oven/bun:1.4 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

FROM base AS backend

ENV PORT=3000
EXPOSE 3000

# Re-sync the node_modules volume with bun.lock on every start, so
# dependency changes apply without recreating the volume.
CMD ["sh", "-c", "bun install --frozen-lockfile && exec bun run start:dev"]

# Runs queue processors; no HTTP port. Re-syncs its own node_modules volume
# like the backend stage.
FROM base AS worker

CMD ["sh", "-c", "bun install --frozen-lockfile && exec bun run worker:dev"]

# nest build needs a real Node.js: under Bun (whose image symlinks `node` to
# bun) it leaves the @/ import alias unrewritten without an error.
FROM node:26-slim AS build

COPY --from=oven/bun:1.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build \
    && if grep -rlF '"@/' dist; then echo "nest build left @/ imports in dist" >&2; exit 1; fi

FROM oven/bun:1.4-slim AS production

# Links the GHCR package to the repository.
LABEL org.opencontainers.image.source=https://github.com/yhagus/routerlm-oss

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Runtime dependencies only. --ignore-scripts skips `prepare` (git hooks).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY --from=build /app/dist ./dist
# Read by dist/migrate.js.
COPY drizzle ./drizzle

USER bun
EXPOSE 3000
CMD ["bun", "dist/main.js"]
