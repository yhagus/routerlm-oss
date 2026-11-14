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

CMD ["bun", "run", "dev"]
