#!/usr/bin/env node
// `rlm` launcher. Mirrors the 9router CLI: start the server, check npm for
// a newer release in parallel, then show the interface menu. The server itself
// is the Bun backend (app/backend) serving the API on BACKEND_PORT and the built
// dashboard (app/frontend/dist) on --port.

const { spawn, exec, execSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const net = require("net");
const os = require("os");
const path = require("path");

const pkg = require("./package.json");
const args = process.argv.slice(2);

// `rlm connect <url>` configures local CLI tools against a remote server and
// `rlm show` prints what they're set to. Neither starts a local server.
if (args[0] === "connect" || args[0] === "show") {
  const { run } = require(args[0] === "show" ? "./src/commands/show" : "./src/commands/connect");
  run(args.slice(1))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`❌ ${err?.message || err}`);
      process.exit(1);
    });
  return;
}

// The npm package is scoped; the command it installs is not.
const APP_NAME = "rlm";
const INSTALL_CMD_LATEST = `npm i -g ${pkg.name}@latest --prefer-online`;
const DEFAULT_PORT = 20130;
const DEFAULT_HOST = "0.0.0.0";
// The backend only binds loopback or all interfaces (backend/src/config.ts).
const SUPPORTED_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0"]);
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || "", 10) || 20129;

let port = DEFAULT_PORT;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
    i++;
  } else if (args[i] === "--host" || args[i] === "-H") {
    host = args[i + 1] || DEFAULT_HOST;
    i++;
  } else if (args[i] === "--no-browser" || args[i] === "-n") {
    noBrowser = true;
  } else if (args[i] === "--log" || args[i] === "-l") {
    showLog = true;
  } else if (args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Usage: ${APP_NAME} [options]

Options:
  -p, --port <port>   Dashboard port (default: ${DEFAULT_PORT}; API also on ${BACKEND_PORT}, set BACKEND_PORT to change)
  -H, --host <host>   Host to bind: 0.0.0.0, 127.0.0.1 or localhost (default: ${DEFAULT_HOST})
  -n, --no-browser    Don't open browser automatically
  -l, --log           Show server logs (default: hidden)
  --skip-update       Skip auto-update check
  -h, --help          Show this help message
  -v, --version       Show version

Commands:
  connect <server-url> Configure local CLI tools for a remote server
                      (npx ${pkg.name} connect http://host:${DEFAULT_PORT} — no install needed)
  show [tool…]        Show each CLI tool's current config and models
                      (e.g. ${APP_NAME} show claude)
`);
    process.exit(0);
  } else if (args[i] === "--version" || args[i] === "-v") {
    console.log(pkg.version);
    process.exit(0);
  }
}

if (!SUPPORTED_HOSTS.has(host)) {
  console.error(`Error: --host must be one of ${[...SUPPORTED_HOSTS].join(", ")}; received "${host}"`);
  process.exit(1);
}
if (port === BACKEND_PORT) {
  console.error(`Error: --port ${port} is the API port. Pick another port or set BACKEND_PORT.`);
  process.exit(1);
}

const appDir = path.join(__dirname, "app");
const backendDir = path.join(appDir, "backend");
const backendMain = path.join(backendDir, "src", "main.ts");
const dashboardDir = path.join(appDir, "frontend", "dist");

if (!fs.existsSync(backendMain) || !fs.existsSync(path.join(dashboardDir, "index.html"))) {
  console.error("Error: Server build not found.");
  console.error("Please run 'bun run build:cli' first.");
  process.exit(1);
}

// Bun ships with the package (`bun` dependency). Its postinstall swaps
// bin/bun.exe for the real binary; when install scripts were skipped, use the
// platform package directly, then a Bun on PATH.
function resolveBun() {
  const candidates = [];
  try {
    const bunDir = path.dirname(require.resolve("bun/package.json"));
    candidates.push(path.join(bunDir, "bin", "bun.exe"));
    const ovenDir = path.join(bunDir, "..", "@oven");
    for (const name of fs.existsSync(ovenDir) ? fs.readdirSync(ovenDir) : []) {
      candidates.push(path.join(ovenDir, name, "bin", process.platform === "win32" ? "bun.exe" : "bun"));
    }
  } catch { }
  for (const file of candidates) {
    try {
      execSync(`"${file}" --version`, { stdio: "ignore", timeout: 10000, windowsHide: true });
      return file;
    } catch { }
  }
  try {
    execSync("bun --version", { stdio: "ignore", timeout: 10000, windowsHide: true });
    return "bun";
  } catch { }
  return null;
}

const RUNTIME = resolveBun();
if (!RUNTIME) {
  console.error("Error: Bun runtime not found.");
  console.error(`Reinstall with install scripts enabled: ${INSTALL_CMD_LATEST}`);
  console.error("Or install Bun: https://bun.sh");
  process.exit(1);
}

// Poll until the server accepts TCP connections on port, or timeout — avoids blind fixed waits.
function waitServerReady(readyPort, { timeoutMs = 30000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryConnect = () => {
      const socket = net.connect({ host: "127.0.0.1", port: readyPort }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryConnect, intervalMs);
      });
    };
    tryConnect();
  });
}

// Native spinner - no external dependency
function createSpinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let interval = null;
  return {
    start() {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${frames[0]} ${text}`);
        interval = setInterval(() => {
          process.stdout.write(`\r${frames[i++ % frames.length]} ${text}`);
        }, 80);
      }
      return this;
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
    },
  };
}

// First non-internal IPv4 — the address remote peers actually reach when bound to 0.0.0.0.
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

function getDisplayHost() {
  return host === DEFAULT_HOST ? "localhost" : host;
}

// Compare semver versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

// Kill earlier rlm servers. Matches this install's backend entry file only,
// so other Bun/Node processes are never touched.
function killAllAppProcesses() {
  const pids = [];
  try {
    if (process.platform === "win32") {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"bun.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, { encoding: "utf8", windowsHide: true, timeout: 5000 });
      for (const line of output.split("\n").slice(1)) {
        if (!line.toLowerCase().includes(backendMain.toLowerCase())) continue;
        const match = line.match(/^"(\d+)"/);
        if (match) pids.push(match[1]);
      }
    } else {
      const output = execSync("ps -eo pid,command 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      for (const line of output.split("\n")) {
        if (!line.includes(backendMain)) continue;
        const pid = line.trim().split(/\s+/)[0];
        if (pid && !isNaN(pid) && pid !== String(process.pid)) pids.push(pid);
      }
    }
  } catch { }
  // SIGTERM lets the old server flush usage and close SQLite.
  for (const pid of pids) {
    try {
      if (process.platform === "win32") execSync(`taskkill /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
      else process.kill(Number(pid), "SIGTERM");
    } catch { }
  }
  return new Promise((resolve) => setTimeout(resolve, pids.length ? 1500 : 0));
}

// Kill any process still listening on port
function killProcessOnPort(targetPort) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: "utf8", shell: true, windowsHide: true, timeout: 5000 });
      const line = output.split("\n").find((l) => l.includes("LISTENING"));
      if (line) execSync(`taskkill /F /PID ${line.trim().split(/\s+/).pop()} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 });
    } else {
      const pid = execSync(`lsof -ti:${targetPort} -sTCP:LISTEN`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim().split("\n")[0];
      if (pid) execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
    }
  } catch {
    // Port is free or error
  }
  return new Promise((resolve) => setTimeout(resolve, 300));
}

// Check if new version available, return latest version or null
function checkForUpdate() {
  return new Promise((resolve) => {
    if (skipUpdate) return resolve(null);

    let resolved = false;
    const done = (version) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeout);
      resolve(version);
    };
    const safetyTimeout = setTimeout(() => done(null), 8000);

    const req = https.get(`https://registry.npmjs.org/${pkg.name.replace("/", "%2F")}/latest`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const latest = JSON.parse(data);
          done(latest.version && compareVersions(latest.version, pkg.version) > 0 ? latest.version : null);
        } catch {
          done(null);
        }
      });
    });
    req.on("error", () => done(null));
    req.on("timeout", () => {
      req.destroy();
      done(null);
    });
  });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, (err) => {
    if (err) console.log(`Open browser manually: ${url}`);
  });
}

function clearScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

async function showInterfaceMenu(latestVersion, serverUrl) {
  const { Select } = require("enquirer");
  const choices = [];
  if (latestVersion) choices.push({ name: "update", message: `⬆  Update to v${latestVersion} (current: v${pkg.version})` });
  choices.push(
    { name: "web", message: "🌐 Web UI (Open in Browser)" },
    { name: "exit", message: "🚪 Exit" },
  );
  clearScreen();
  console.log(`🚀 Server: \x1b[32m${serverUrl}\x1b[0m\n`);
  try {
    return await new Select({ message: `Choose Interface (v${pkg.version})`, choices }).run();
  } catch {
    return "exit"; // Ctrl+C / Esc
  }
}

const MAX_RESTARTS = 2;
const RESTART_RESET_MS = 30000; // Reset counter if alive > 30s
const CRASH_LOG_LINES = 50;

function startServer(updatePromise) {
  const displayHost = getDisplayHost();
  const serverUrl = `http://${displayHost}:${port}`;
  const dashboardUrl = `${serverUrl}/dashboard`;
  if (host === DEFAULT_HOST) {
    const lanIp = getLanIp();
    if (lanIp) console.log(`\x1b[33m⚠ Network-exposed: reachable at http://${lanIp}:${port} (bound 0.0.0.0). Use --host 127.0.0.1 for local-only.\x1b[0m`);
  }

  let restartCount = 0;
  let serverStartTime = Date.now();
  let crashLog = [];
  let isShuttingDown = false;

  function spawnServer() {
    serverStartTime = Date.now();
    crashLog = [];
    const child = spawn(RUNTIME, [backendMain], {
      cwd: backendDir,
      stdio: showLog ? "inherit" : ["ignore", "ignore", "pipe"],
      windowsHide: true,
      env: {
        NODE_ENV: "production",
        // Keep the outbound fetch cap above the global in-flight cap (see Dockerfile).
        BUN_CONFIG_MAX_HTTP_REQUESTS: "4096",
        ...process.env,
        BACKEND_HOST: host,
        BACKEND_PORT: String(BACKEND_PORT),
        DASHBOARD_DIR: dashboardDir,
        DASHBOARD_PORT: String(port),
      },
    });
    if (!showLog && child.stderr) {
      child.stderr.on("data", (data) => {
        crashLog.push(...data.toString().split("\n").filter(Boolean));
        if (crashLog.length > CRASH_LOG_LINES) crashLog = crashLog.slice(-CRASH_LOG_LINES);
      });
    }
    child.on("error", (err) => {
      console.error("Failed to start server:", err.message);
      if (!isShuttingDown) tryRestart();
    });
    child.on("close", (code) => {
      if (isShuttingDown || code === 0) {
        process.exit(code || 0);
        return;
      }
      tryRestart(code);
    });
    return child;
  }

  function tryRestart(code) {
    if (Date.now() - serverStartTime >= RESTART_RESET_MS) restartCount = 0;
    if (restartCount >= MAX_RESTARTS) {
      console.error(`\n❌ Server crashed ${MAX_RESTARTS + 1} times in a row. Run with --log to see why.`);
      crashLog.forEach((l) => console.error(l));
      process.exit(1);
    }
    restartCount++;
    const delay = Math.min(1000 * restartCount, 10000);
    console.error(`\n⚠️  Server exited (code=${code ?? "unknown"}). Restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS})`);
    if (crashLog.length) {
      console.error("\n--- Server crash log ---");
      crashLog.forEach((l) => console.error(l));
      console.error("--- End crash log ---\n");
    }
    setTimeout(() => {
      server = spawnServer();
    }, delay);
  }

  let server = spawnServer();

  // SIGTERM runs the backend's graceful shutdown (flushes usage, closes SQLite);
  // SIGKILL only if it hangs. The server's exit then ends this process.
  function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try {
      server.kill("SIGTERM");
    } catch { }
    setTimeout(() => {
      try {
        server.kill("SIGKILL");
      } catch { }
      process.exit(0);
    }, 8000).unref();
  }

  process.on("SIGINT", () => {
    if (!isShuttingDown) console.log("\nExiting...");
    shutdown();
  });
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);

  waitServerReady(port).then(async (ready) => {
    if (!ready) {
      console.error(`⚠️  Server is not answering on port ${port} yet. Run with --log to see its output.`);
    }
    if (!noBrowser && ready) openBrowser(dashboardUrl);

    // Without a terminal there is no menu: keep serving until stopped.
    if (!process.stdin.isTTY || showLog) {
      console.log(`\n🚀 ${APP_NAME} v${pkg.version}`);
      console.log(`Dashboard: ${dashboardUrl}`);
      console.log(`API:       http://${displayHost}:${BACKEND_PORT}/v1 (also ${serverUrl}/v1)`);
      return;
    }

    const latestVersion = await updatePromise;
    while (!isShuttingDown) {
      const choice = await showInterfaceMenu(latestVersion, serverUrl);
      if (choice === "update") {
        clearScreen();
        console.log(`\n⬆  Update v${pkg.version} → v${latestVersion}\n`);
        console.log("Run this after exit:\n");
        console.log(`   \x1b[33m${INSTALL_CMD_LATEST}\x1b[0m\n`);
        shutdown();
        return;
      }
      if (choice === "web") {
        openBrowser(dashboardUrl);
        console.log(`\nOpened ${dashboardUrl}`);
        try {
          const { Input } = require("enquirer");
          await new Input({ message: "Press Enter to go back to menu..." }).run();
        } catch { }
        continue;
      }
      console.log("\nExiting...");
      shutdown();
      return;
    }
  });
}

// Start server immediately; run update check in parallel (not on the critical path).
const spinner = skipUpdate ? null : createSpinner("Starting server...").start();
const updatePromise = checkForUpdate();
killAllAppProcesses()
  .then(() => killProcessOnPort(port))
  .then(() => killProcessOnPort(BACKEND_PORT))
  .then(() => {
    spinner?.stop();
    startServer(updatePromise);
  });
