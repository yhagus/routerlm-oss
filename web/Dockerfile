# Images for the Nuxt frontend.
#   dev: used by docker-compose.yml with the source mounted as a volume.
#   production: the published image (ghcr.io/yhagus/routerlm-web), the built
#     Nitro server run on Bun; see deploy/compose.yaml.
FROM oven/bun:1.4 AS deps

WORKDIR /app

COPY package.json bun.lock ./
# Skip the postinstall (`nuxt prepare`): the source isn't copied yet, and
# `nuxt dev` and `nuxt build` regenerate .nuxt anyway.
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

FROM deps AS dev

# Bind to all interfaces so the dev server is reachable from the host.
ENV HOST=0.0.0.0 \
    PORT=3000
EXPOSE 3000

# Re-sync the node_modules volume with bun.lock on every start, so
# dependency changes apply without recreating the volume.
CMD ["sh", "-c", "bun install --frozen-lockfile --ignore-scripts && exec bun run dev"]

FROM deps AS build

RUN bun run build

FROM oven/bun:1.4-slim AS production

# Links the GHCR package to the repository.
LABEL org.opencontainers.image.source=https://github.com/yhagus/routerlm-oss

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# .output is self-contained: no node_modules needed.
COPY --from=build --chown=bun:bun /app/.output ./.output
RUN chown bun:bun /app

USER bun
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
