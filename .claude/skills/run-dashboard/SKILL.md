---
name: run-dashboard
description: Run the backend and web dashboard on demo data, from the repo or a worktree, to look at a UI change in the real app. Use when asked to run, start, screenshot or manually verify the dashboard (web/), or when a web change has no other verification.
---

Starts an isolated demo stack: its own compose project, ports and volumes, so the user's own `docker compose` stack and data stay untouched. The containers mount the current directory, so the stack serves the code of whichever checkout you start it from.

## Steps

1. From the checkout to run (repo root or worktree root), export the demo settings in the same shell call as each compose command. The key only has to stay the same while the stack lives:

   ```bash
   export COMPOSE_PROJECT_NAME=routerlm-demo POSTGRES_DB=routerlm_demo \
     BACKEND_PORT=3100 WEB_PORT=3101 DB_PORT=5433 REDIS_PORT=6380 \
     ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -base64 32)}"
   ```

   `POSTGRES_DB` must end in `_demo`: `db:seed:demo` truncates every table and refuses any other name.

2. `docker compose up -d --wait`. The first run builds images and takes about 3 minutes; run it in the background. Done when every service reports Healthy and `migrate` reports Exited.

3. `docker compose exec -T backend bun run db:seed:demo`. Done when it logs `Seeded <n> Usage Logs`. Re-run it to reset the data.

4. Wait for the web dev server: `curl -s -o /dev/null -w "%{http_code}" localhost:3101/login` returns 200. Nuxt answers 503 for about a minute after start.

5. Open http://localhost:3101 and sign in as `admin@example.com` / `routerlm-demo`. Drive and screenshot it with the `claude-in-chrome` or `run` skill. The API is at http://localhost:3100/api (`POST /api/auth/login` with that email and password sets the session cookie, for curl checks); the gateway is at http://localhost:3100/v1.

6. Logs: `docker compose logs --tail 100 backend worker web`.

7. Tear down when finished, with the same exports: `docker compose down -v`.

Only one checkout can run the demo stack at a time on these ports. Tear it down before starting it from another worktree.
