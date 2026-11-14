# Development image for the Nuxt frontend.
FROM oven/bun:1.4

WORKDIR /app

COPY package.json bun.lock ./
# Skip the root postinstall (`nuxt prepare`): the source isn't copied yet,
# and `nuxt dev` regenerates .nuxt on start anyway.
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

# Bind to all interfaces so the dev server is reachable from the host.
ENV HOST=0.0.0.0 \
    PORT=3000
EXPOSE 3000

# Re-sync the node_modules volume with bun.lock on every start, so
# dependency changes apply without recreating the volume.
CMD ["sh", "-c", "bun install --frozen-lockfile --ignore-scripts && exec bun run dev"]
