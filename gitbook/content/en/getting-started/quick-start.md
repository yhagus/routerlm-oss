# Getting Started

This guide starts the Version 2 gateway and dashboard.

## 1. Install dependencies

```bash
bun install
```

## 2. Start the backend

```bash
bun run dev:backend
```

The backend listens on `http://127.0.0.1:20129`.

## 3. Start the dashboard

Run this command in another terminal.

```bash
bun run dev:frontend
```

Open `http://127.0.0.1:20130` in your browser.

## 4. Configure access

Sign in with the configured initial password.

Open **Providers** and add a provider connection.

Open **API Keys** and create a client key when required.

## 5. Configure a client

Use these values in an OpenAI-compatible client.

```text
Base URL: http://127.0.0.1:20129/v1
API key: your LobakAI API key
Model: a configured model or combo
```

## 6. Verify a request

```bash
curl http://127.0.0.1:20129/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_MODEL","messages":[{"role":"user","content":"Hello"}]}'
```

The dashboard lists provider, model, combo, and usage details.
