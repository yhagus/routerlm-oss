import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KILL_TIMEOUT_MS = 5000;
const PROCESS_WAIT_MS = 1500;

// Kill MITM server by PID file (MITM may run as admin/sudo).
function killMitmByPidFile(dataDir: string): void {
  try {
    const mitmPidFile = join(dataDir, "mitm", ".mitm.pid");
    if (!existsSync(mitmPidFile)) return;
    const pid = parseInt(readFileSync(mitmPidFile, "utf8").trim(), 10);
    if (!pid) return;
    if (process.platform === "win32") {
      try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { /* best effort */ }
    } else {
      try {
        execSync(`sudo -n kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
      } catch {
        try { process.kill(pid, "SIGKILL"); } catch { /* best effort */ }
      }
    }
    try { writeFileSync(mitmPidFile, ""); } catch { /* best effort */ }
  } catch { /* best effort */ }
}

// Collect PIDs of all 9router-related processes (excluding the current one).
function collectAppPids(): string[] {
  const pids: string[] = [];
  if (process.platform === "win32") {
    for (const name of ["node.exe", "cloudflared", "tray_windows_release"]) {
      try {
        const output = execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "Get-Process ${name} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`, { encoding: "utf8", windowsHide: true, timeout: KILL_TIMEOUT_MS });
        for (const line of output.split("\n")) {
          const pid = line.trim();
          if (pid && !Number.isNaN(Number(pid)) && pid !== process.pid.toString()) pids.push(pid);
        }
      } catch { /* not running */ }
    }
    return pids;
  }
  try {
    const output = execSync("ps aux 2>/dev/null", { encoding: "utf8", timeout: KILL_TIMEOUT_MS });
    for (const line of output.split("\n")) {
      const isAppProcess = line.includes("9router")
        || line.includes("next-server")
        || line.includes("cloudflared")
        || line.includes("/bin/app/")
        || line.includes("tray_darwin")
        || line.includes("tray_linux");
      if (!isAppProcess) continue;
      const pid = line.trim().split(/\s+/)[1];
      if (pid && !Number.isNaN(Number(pid)) && pid !== process.pid.toString()) pids.push(pid);
    }
  } catch { /* no processes */ }
  return pids;
}

// Kill all app-related processes to release file locks (especially on Windows).
export async function killAppProcesses(dataDir: string): Promise<void> {
  killMitmByPidFile(dataDir);
  const pids = collectAppPids();
  for (const pid of pids) {
    try {
      if (process.platform === "win32") execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 } as unknown as Parameters<typeof execSync>[1]);
      else execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
    } catch { /* already dead */ }
  }
  if (pids.length > 0) await new Promise<any>((resolve) => setTimeout(resolve, PROCESS_WAIT_MS));
}

let cachedVersion: string | null = null;
export function currentVersion(): string {
  if (!cachedVersion) {
    try {
      cachedVersion = String(JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version || "0.0.0");
    } catch {
      cachedVersion = "0.0.0";
    }
  }
  return cachedVersion;
}
