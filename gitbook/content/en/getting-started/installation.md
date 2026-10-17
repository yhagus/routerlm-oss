# Installation

Install LobakAI from this source repository.

Version 2 requires Bun.

## Requirements

- Bun 1.3.14 or a compatible later release.
- macOS, Linux, or Windows with a supported Bun environment.
- Network access for provider authentication and API requests.

Check the Bun version.

```bash
bun --version
```

## Install

Clone the repository and install workspace dependencies.

```bash
git clone <repository-url> lobakai
cd lobakai
bun install
```

Create the backend environment file.

```bash
cp backend/.env.example backend/.env
```

Set a strong `JWT_SECRET` before production use.

Set a strong `INITIAL_PASSWORD` before production use.

## Start the services

Start the backend in one terminal.

```bash
bun run dev:backend
```

Start the dashboard in another terminal.

```bash
bun run dev:frontend
```

Open `http://127.0.0.1:20130` in a browser.

Use `http://127.0.0.1:20129/v1` as the OpenAI-compatible base URL.

## Verify installation

Check the backend health endpoint.

```bash
curl http://127.0.0.1:20129/api/health
```

List models after you configure a provider.

```bash
curl http://127.0.0.1:20129/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Production

Build the dashboard before preview deployment.

```bash
bun run build
```

Start the backend and dashboard as separate processes.

```bash
bun run start:backend
bun run preview:frontend
```

Use Docker or PM2 for managed deployments.
