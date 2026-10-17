# Cloud Deployment

Deploy the backend and dashboard as separate Bun processes.

Use a reverse proxy for public HTTPS access.

## VPS deployment

Install Bun and clone the repository.

```bash
git clone <repository-url> lobakai
cd lobakai
bun install
cp backend/.env.example backend/.env
```

Set secure backend values in `backend/.env`.

```text
JWT_SECRET=replace-with-a-long-random-secret
INITIAL_PASSWORD=replace-with-a-strong-password
DATA_DIR=/var/lib/lobakai
BACKEND_DATABASE_PATH=/var/lib/lobakai/data.sqlite
```

Build the dashboard.

```bash
bun run build
```

Start both processes with PM2.

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
```

The backend listens on `127.0.0.1:20129`.

The dashboard listens on `127.0.0.1:20130`.

Configure the reverse proxy to send browser traffic to port `20130`.

Configure API clients to use port `20129`.

## Docker deployment

Build the bundled image.

```bash
docker build -t lobakai .
```

Run the image with persistent data.

```bash
docker run -d \
  --name lobakai \
  -p 20129:20129 \
  -p 20130:20130 \
  -e JWT_SECRET="replace-with-a-long-random-secret" \
  -e INITIAL_PASSWORD="replace-with-a-strong-password" \
  -v lobakai-data:/app/data \
  lobakai
```

Open the dashboard through port `20130`.

Send gateway requests through port `20129`.

Use `docker compose up -d` when you need the included Headroom service.
