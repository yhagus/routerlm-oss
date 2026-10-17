# Localhost Deployment

Run the backend and dashboard as separate Bun processes.

## Install

```bash
bun install
cp backend/.env.example backend/.env
```

Set `JWT_SECRET` and `INITIAL_PASSWORD` in `backend/.env`.

## Start development services

Start the backend.

```bash
bun run dev:backend
```

Start the dashboard in another terminal.

```bash
bun run dev:frontend
```

The dashboard listens on `http://127.0.0.1:20130`.

The gateway listens on `http://127.0.0.1:20129`.

## Start production services

Build the dashboard first.

```bash
bun run build
```

Start the backend and dashboard in separate terminals.

```bash
bun run start:backend
bun run preview:frontend
```

## Configure paths and ports

Set `DATA_DIR` to select the runtime data directory.

Set `BACKEND_DATABASE_PATH` to select the SQLite file.

Set `BACKEND_PORT` to change the gateway port.

Set `VITE_BACKEND_ORIGIN` to change the frontend proxy target.

## Stop services

Press `Ctrl+C` in each service terminal.

The backend closes the database during shutdown.
