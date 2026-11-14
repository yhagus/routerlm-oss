# Development images for the NestJS backend and its queue worker (run on Bun).
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
