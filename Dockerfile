# Development image for the NestJS backend (runs on Bun).
FROM oven/bun:1.4

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV PORT=3000
EXPOSE 3000

# Re-sync the node_modules volume with bun.lock on every start, so
# dependency changes apply without recreating the volume.
CMD ["sh", "-c", "bun install --frozen-lockfile && exec bun run start:dev"]
