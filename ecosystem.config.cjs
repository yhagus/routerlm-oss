/**
 * PM2 production start for LobakAI v2 (Bun + Hono backend, Vue + Vite frontend).
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 */
const path = require("path");

const root = __dirname;
const bun = process.env.BUN_PATH || "bun";

module.exports = {
  apps: [
    {
      name: "lobakai-backend",
      cwd: path.join(root, "backend"),
      script: "bash",
      // Bun queues outbound fetch above BUN_CONFIG_MAX_HTTP_REQUESTS (default 256).
      // Each in-flight stream holds one upstream fetch, and the global in-flight
      // cap (settings.maxInFlightRequests) defaults to 2500. 4096 keeps the fetch
      // cap above that cap. Set the variable in the environment to override it.
      args: ["-lc", `ulimit -n 65535 && export BUN_CONFIG_MAX_HTTP_REQUESTS="\${BUN_CONFIG_MAX_HTTP_REQUESTS:-4096}" && exec ${JSON.stringify(bun)} run src/main.ts`],
      exec_interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 10000,
      time: true,
      env_production: {
        NODE_ENV: "production",
        BACKEND_HOST: "127.0.0.1",
        BACKEND_PORT: "20129",
      },
    },
    {
      name: "lobakai-frontend",
      cwd: path.join(root, "frontend"),
      script: bun,
      args: "run preview",
      exec_interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 10000,
      time: true,
      env_production: {
        NODE_ENV: "production",
        VITE_BACKEND_ORIGIN: "http://127.0.0.1:20129",
      },
    },
  ],
};