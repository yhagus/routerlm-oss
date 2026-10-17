# Docker

The container runs the Bun backend and Vite dashboard as separate processes.

The backend listens on port `20129`.

The dashboard listens on port `20130`.

## Build an image

```bash
docker build -t lobakai .
```

## Run an image

```bash
docker run -d \
  -p 20129:20129 \
  -p 20130:20130 \
  -v lobakai-data:/app/data \
  -e JWT_SECRET="replace-this-secret" \
  -e INITIAL_PASSWORD="replace-this-password" \
  --name lobakai \
  lobakai
```

Open the dashboard at `http://localhost:20130`.

Send gateway requests to `http://localhost:20129/v1`.

## Docker Compose

Create `.env` from `.env.example`.

Run this command.

```bash
docker compose up -d
```

The Compose configuration stores SQLite data in `lobakai-data`.

## Data paths

The container sets `DATA_DIR=/app/data`.

The container sets `BACKEND_DATABASE_PATH=/app/data/data.sqlite`.

Mount `/app/data` before replacing or recreating a container.

## Inspect and stop

```bash
docker logs -f lobakai
docker stop lobakai
docker rm lobakai
```
