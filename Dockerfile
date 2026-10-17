# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS builder

COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN bun install --frozen-lockfile

COPY . ./
ENV NODE_ENV=production
# Build the Vue dashboard to static output under frontend/dist.
RUN bun run build:frontend

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=20129
ENV DATA_DIR=/app/data
ENV BACKEND_DATABASE_PATH=/app/data/data.sqlite
# Keep the outbound fetch cap above the global in-flight cap (default 2500).
ENV BUN_CONFIG_MAX_HTTP_REQUESTS=4096
ENV VITE_HOST=0.0.0.0

# Workspace metadata + runtime deps + built frontend.
COPY package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN bun install --frozen-lockfile

COPY backend ./backend
COPY frontend/dist ./frontend/dist
COPY frontend/index.html ./frontend/index.html
COPY start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 20129 20130
VOLUME /app/data

CMD ["./start.sh"]
