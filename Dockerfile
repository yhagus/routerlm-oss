# Development image for the NestJS backend (runs on Bun).
FROM oven/bun:1.4

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "start:dev"]
