import type { Runtime } from "../../runtime";
// Pure v1 tunnel primitives: binary download/spawn/kill, pid + state files,
// DNS-resolver health probes, and the tailscale CLI wrapper. Only the manager
// layer was DB-coupled in v1; that part is re-implemented here on v2 settings.
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler, ensureCloudflared, getDownloadStatus } from "./tunnel/cloudflare/cloudflared.ts";
import { clearPid } from "./tunnel/cloudflare/pid.ts";
import { waitForHealth, probeUrlAlive } from "./tunnel/cloudflare/healthCheck.ts";
import { loadState, saveState, generateShortId } from "./tunnel/shared/state.ts";
import { WORKER_URL } from "./tunnel/cloudflare/config.ts";
import { TAILSCALE_SOCKET, getTailscaleBin, isTailscaleInstalled, isTailscaleLoggedIn, isTailscaleLoggedInStrict, isTailscaleRunning, isTailscaleRunningStrict, isSystemDaemonRunning, isDaemonAlive, startDaemonWithPassword, startLogin, startFunnel, stopFunnel, installTailscale, provisionCert, getTailscaleFunnelUrl } from "./tunnel/tailscale/tailscale.ts";

const service = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  activeLocalPort: null as number | null,
  tailscaleSpawnInProgress: false,
  tailscaleCancelToken: { cancelled: false },
};

function throwIfCancelled(token: { cancelled: boolean }) {
  if (token.cancelled) throw new Error("tunnel cancelled");
}

async function registerTunnelUrl(shortId: string, tunnelUrl: string) {
  await fetch(`${WORKER_URL}/api/tunnel/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortId, tunnelUrl }),
  }).catch(() => { /* worker registration is best-effort */ });
}

// v1 enableTunnel: reuse a live tunnel when both URLs answer, otherwise kill,
// (downloading cloudflared on demand) and spawn a quick tunnel.
export async function enableCloudflareTunnel(runtime: Runtime, localPort: number) {
  service.cancelToken = { cancelled: false };
  service.activeLocalPort = localPort;
  service.spawnInProgress = true;
  const token = service.cancelToken;
  try {
    if (isCloudflaredRunning()) {
      const existing = loadState() as { shortId?: string; tunnelUrl?: string } | null;
      if (existing?.tunnelUrl && existing?.shortId) {
        const publicUrl = `https://r${existing.shortId}.abc-tunnel.us`;
        const [directOk, publicOk] = await Promise.all([probeUrlAlive(existing.tunnelUrl), probeUrlAlive(publicUrl)]);
        if (directOk && publicOk) {
          return { success: true, tunnelUrl: existing.tunnelUrl, shortId: existing.shortId, publicUrl, alreadyRunning: true };
        }
      }
    }

    killCloudflared(localPort);
    throwIfCancelled(token);
    await ensureCloudflared();

    const existing = loadState() as { shortId?: string } | null;
    const shortId = existing?.shortId || generateShortId();

    const onUrlUpdate = async (url: string) => {
      if (token.cancelled) return;
      await registerTunnelUrl(shortId, url);
      saveState({ shortId, tunnelUrl: url });
      runtime.repos.settings.update({ tunnelEnabled: true, tunnelUrl: url });
    };

    setUnexpectedExitHandler(() => { /* watchdog restart lands with M10 monitoring */ });

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate) as { tunnelUrl: string };
    throwIfCancelled(token);

    const publicUrl = `https://r${shortId}.abc-tunnel.us`;
    await registerTunnelUrl(shortId, tunnelUrl);
    saveState({ shortId, tunnelUrl });
    runtime.repos.settings.update({ tunnelEnabled: true, tunnelUrl });

    await waitForHealth(publicUrl, token);
    await probeUrlAlive(tunnelUrl).catch(() => false);
    return { success: true, tunnelUrl, shortId, publicUrl };
  } finally {
    service.spawnInProgress = false;
  }
}

export async function disableCloudflareTunnel(runtime: Runtime) {
  service.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);
  try { killCloudflared(service.activeLocalPort ?? undefined); } catch { /* already dead */ }
  clearPid();
  const state = loadState() as { shortId?: string } | null;
  if (state) saveState({ shortId: state.shortId, tunnelUrl: null });
  runtime.repos.settings.update({ tunnelEnabled: false, tunnelUrl: "" });
  service.spawnInProgress = false;
  service.activeLocalPort = null;
  return { success: true };
}

export async function cloudflareTunnelStatus(runtime: Runtime) {
  const settings = runtime.repos.settings.get() as Record<string, unknown>;
  const state = loadState() as { shortId?: string; tunnelUrl?: string } | null;
  const shortId = state?.shortId || "";
  const publicUrl = shortId ? `https://r${shortId}.abc-tunnel.us` : "";
  const tunnelUrl = String(settings.tunnelUrl || state?.tunnelUrl || "");
  const enabled = settings.tunnelEnabled === true;
  const running = enabled ? (shortId ? isCloudflaredRunning() : false) : false;
  return { enabled, settingsEnabled: enabled, tunnelUrl, shortId, publicUrl, running };
}

// v1 enableTailscale flow on v2 settings: daemon → login check → funnel → cert.
export async function enableTailscaleTunnel(runtime: Runtime, localPort: number, sudoPassword = "") {
  service.tailscaleCancelToken = { cancelled: false };
  service.tailscaleSpawnInProgress = true;
  const token = service.tailscaleCancelToken;
  try {
    await startDaemonWithPassword(sudoPassword);
    throwIfCancelled(token);

    const existing = loadState() as { shortId?: string } | null;
    const shortId = existing?.shortId || generateShortId();

    if (!(await isTailscaleLoggedInStrict())) {
      const loginResult = await startLogin(shortId) as { authUrl?: string };
      if (loginResult?.authUrl) return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
    }
    throwIfCancelled(token);

    stopFunnel();
    let result: { tunnelUrl?: string; funnelNotEnabled?: boolean; enableUrl?: string };
    try {
      result = await startFunnel(localPort);
    } catch (error: any) {
      if (/NoState|unexpected state|not logged in|Logged ?out|NeedsLogin/i.test((error as Error).message || "")) {
        const loginResult = await startLogin(shortId) as { authUrl?: string };
        if (loginResult?.authUrl) return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
      }
      throw error;
    }
    throwIfCancelled(token);
    if (result.funnelNotEnabled) return { success: false, funnelNotEnabled: true, enableUrl: result.enableUrl };

    if (!(await isTailscaleLoggedInStrict()) || !(await isTailscaleRunningStrict())) {
      stopFunnel();
      return { success: false, error: "Tailscale not connected. Device may have been removed. Please re-login." };
    }

    runtime.repos.settings.update({ tailscaleEnabled: true, tailscaleUrl: result.tunnelUrl });
    // TLS cert for Funnel HTTPS is best-effort (DNS propagation may lag).
    try {
      await provisionCert(new URL(String(result.tunnelUrl)).hostname);
    } catch { /* non-fatal */ }
    try { await waitForHealth(String(result.tunnelUrl), token); } catch { /* watchdog retries */ }
    return { success: true, tunnelUrl: result.tunnelUrl };
  } finally {
    service.tailscaleSpawnInProgress = false;
  }
}

export async function disableTailscaleTunnel(runtime: Runtime) {
  service.tailscaleCancelToken.cancelled = true;
  try { stopFunnel(); } catch { /* already stopped */ }
  runtime.repos.settings.update({ tailscaleEnabled: false, tailscaleUrl: "" });
  return { success: true };
}

export async function tailscaleStatus(runtime: Runtime) {
  const settings = runtime.repos.settings.get() as Record<string, unknown>;
  const enabled = settings.tailscaleEnabled === true;
  // Dashboard poll: use the cached, non-blocking getters (they kick a background
  // refresh and return the last known state). The strict subprocess probes block
  // up to 5s and are reserved for hot user-initiated paths (enable/connect).
  return {
    enabled,
    settingsEnabled: enabled,
    tunnelUrl: String(settings.tailscaleUrl || ""),
    running: enabled ? isTailscaleRunning() : false,
    loggedIn: isTailscaleLoggedIn(),
  };
}

// Synchronous filesystem probes from the v1 lib; guard them individually.
const syncBoolean = (probe: () => boolean): boolean => {
  try {
    return probe() === true;
  } catch {
    return false;
  }
};

export async function tailscaleCheck() {
  const installed = isTailscaleInstalled();
  const customDaemonRunning = installed ? syncBoolean(() => isDaemonAlive()) : false;
  const systemDaemonRunning = syncBoolean(() => isSystemDaemonRunning());
  return {
    installed,
    loggedIn: installed ? await isTailscaleLoggedInStrict().catch(() => false) : false,
    platform: process.platform,
    brewAvailable: process.platform === "darwin" && await (await import("./host")).commandExists("brew"),
    daemonRunning: customDaemonRunning || systemDaemonRunning,
    customDaemonRunning,
    systemDaemonRunning,
    hasCachedPassword: false,
  };
}

export { getDownloadStatus, installTailscale, getTailscaleFunnelUrl, TAILSCALE_SOCKET, getTailscaleBin };
