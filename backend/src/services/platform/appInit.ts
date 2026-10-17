// Port of v1 src/shared/services/initializeApp.js runtime pieces: boot
// auto-resume for tunnel/tailscale/MITM, the 60s watchdog, and the network
// monitor (IPv4 fingerprint change + sleep/wake + online-edge detection).
// The grok-cli availability probe and quota auto-ping schedulers read the
// legacy localDb and remain ported as v2-native follow-ups.
import os from "os";
import type { Runtime } from "../../runtime";
import { checkInternet } from "./tunnel/shared/internetCheck.ts";
import { isCloudflaredRunning, ensureCloudflared } from "./tunnel/cloudflare/cloudflared.ts";
import { isTailscaleRunning, isTailscaleRunningStrict, isDaemonAlive, startFunnel } from "./tunnel/tailscale/tailscale.ts";
import { RESTART_COOLDOWN_MS, NETWORK_SETTLE_MS, WATCHDOG_INTERVAL_MS, NETWORK_CHECK_INTERVAL_MS, VIRTUAL_IFACE_REGEX } from "./tunnel/shared/watchdogConfig.ts";
import { getMitmStatus, startServer, loadEncryptedPassword, setCachedPassword, restoreToolDNS } from "./mitm/manager.ts";
import { enableCloudflareTunnel, enableTailscaleTunnel } from "./tunnelManager";
import { startGrokCliAvailabilityProbe, stopGrokCliAvailabilityProbe } from "../providers/grokCliAvailabilityProbe";
import { configureQuotaAutoPing, stopQuotaAutoPing } from "../billing/quotaAutoPing";
import { configureAutoclawTasks, stopAutoclawTasks } from "../billing/autoclawTasksScheduler";
import { configureCodebuddyProbe, stopCodebuddyProbe } from "../providers/codebuddyProbeScheduler";
import { startTokenRefreshScheduler, stopTokenRefreshScheduler } from "../billing/tokenRefreshScheduler";
import { syncModelCatalog } from "../providers/modelSync";

// Cooldown only applies to repeating watchdog ticks (anti hammer-loop).
// Network/exit events are one-shot transitions → bypass to recover fast.
const FORCE_RESTART_REASONS = /^(startup|netchange|sleep|sleep\+netchange|online|unexpected-exit)$/;

const state = {
  tunnelAutoResumed: false,
  tailscaleAutoResumed: false,
  mitmStartInProgress: false,
  watchdogInterval: null as ReturnType<typeof setInterval> | null,
  networkMonitorInterval: null as ReturnType<typeof setInterval> | null,
  lastNetworkFingerprint: null as string | null,
  lastWatchdogTick: 0,
  lastOnline: null as boolean | null,
  lastTunnelRestartAt: 0,
  lastTailscaleRestartAt: 0,
};

async function safeRestartTunnel(runtime: Runtime, reason: string): Promise<void> {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  if (!settings.tunnelEnabled) return;
  // Process alive = trust cloudflared (self-reconnects via --retries 99, keeps
  // same URL). Killing a live process on network change drops the tunnel and
  // rotates the quick-tunnel URL.
  if (isCloudflaredRunning()) return;
  const force = FORCE_RESTART_REASONS.test(reason);
  if (!force && Date.now() - state.lastTunnelRestartAt < RESTART_COOLDOWN_MS) return;
  if (!(await checkInternet())) return;
  try {
    await enableCloudflareTunnel(runtime, Number(runtime.config.port || 20129));
    state.lastTunnelRestartAt = Date.now();
  } catch { /* v1 logs and keeps the watchdog armed */ }
}

async function safeRestartTailscale(runtime: Runtime, reason: string): Promise<void> {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  if (!settings.tailscaleEnabled) return;
  // Tailscale daemon is OS-level with built-in reconnect; trust it when running
  // (even on netchange). Startup uses a strict probe — cached state is cold.
  const running = reason === "startup" ? await isTailscaleRunningStrict() : isTailscaleRunning();
  if (running) return;

  // Daemon alive but funnel dropped → recover funnel only; never full-restart
  // (preserves login/daemon).
  if (isDaemonAlive()) {
    try {
      await startFunnel(Number(runtime.config.port || 20129));
      state.lastTailscaleRestartAt = Date.now();
    } catch { /* keep watchdog armed */ }
    return;
  }

  const force = FORCE_RESTART_REASONS.test(reason);
  if (!force && Date.now() - state.lastTailscaleRestartAt < RESTART_COOLDOWN_MS) return;
  if (!(await checkInternet())) return;
  try {
    await enableTailscaleTunnel(runtime, Number(runtime.config.port || 20129));
    state.lastTailscaleRestartAt = Date.now();
  } catch { /* keep watchdog armed */ }
}

function startWatchdog(runtime: Runtime): void {
  if (state.watchdogInterval) return;
  state.watchdogInterval = setInterval(() => {
    safeRestartTunnel(runtime, "watchdog").catch(() => {});
    safeRestartTailscale(runtime, "watchdog").catch(() => {});
  }, WATCHDOG_INTERVAL_MS);
  state.watchdogInterval.unref?.();
}

function stopWatchdog(): void {
  if (!state.watchdogInterval) return;
  clearInterval(state.watchdogInterval);
  state.watchdogInterval = null;
}

function getNetworkFingerprint(): string {
  const interfaces = os.networkInterfaces();
  const active: string[] = [];
  for (const [name, addrs] of Object.entries(interfaces as Record<string, any>)) {
    if (!addrs) continue;
    if (VIRTUAL_IFACE_REGEX.test(name)) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") active.push(`${name}:${addr.address}`);
    }
  }
  return active.sort().join("|");
}

function startNetworkMonitor(runtime: Runtime): void {
  if (state.networkMonitorInterval) return;
  state.lastNetworkFingerprint = getNetworkFingerprint();
  state.lastWatchdogTick = Date.now();
  state.lastOnline = null;

  state.networkMonitorInterval = setInterval(async () => {
    try {
      const now = Date.now();
      const elapsed = now - state.lastWatchdogTick;
      state.lastWatchdogTick = now;

      const currentFingerprint = getNetworkFingerprint();
      const networkChanged = currentFingerprint !== state.lastNetworkFingerprint;
      const wasSleep = elapsed > NETWORK_CHECK_INTERVAL_MS * 6;
      if (networkChanged) state.lastNetworkFingerprint = currentFingerprint;

      // Real reachability check (TCP 1.1.1.1:443) — not just interface presence.
      const online = await checkInternet();
      const wasOffline = state.lastOnline === false;
      state.lastOnline = online;
      if (!online) return; // no internet → idle, don't restart

      const onlineEdge = wasOffline;
      if (!networkChanged && !wasSleep && !onlineEdge) return;

      // Wait for DHCP/DNS to settle before probing.
      await new Promise<any>((resolve) => setTimeout(resolve, NETWORK_SETTLE_MS));

      const reason = onlineEdge ? "online" : wasSleep && networkChanged ? "sleep+netchange" : wasSleep ? "sleep" : "netchange";
      safeRestartTunnel(runtime, reason).catch(() => {});
      safeRestartTailscale(runtime, reason).catch(() => {});
    } catch { /* monitor must not die */ }
  }, NETWORK_CHECK_INTERVAL_MS);

  state.networkMonitorInterval.unref?.();
}

function stopNetworkMonitor(): void {
  if (!state.networkMonitorInterval) return;
  clearInterval(state.networkMonitorInterval);
  state.networkMonitorInterval = null;
  state.lastNetworkFingerprint = null;
  state.lastOnline = null;
}

export function configureTunnelMonitoring(settings: Record<string, any>, runtime: Runtime): void {
  if (settings?.tunnelEnabled || settings?.tailscaleEnabled) {
    startWatchdog(runtime);
    startNetworkMonitor(runtime);
    return;
  }
  stopWatchdog();
  stopNetworkMonitor();
}

// v1 autoStartMitm: only with a saved sudo password (non-Windows), using the
// default public API key, and restoring per-tool DNS afterwards.
async function autoStartMitm(runtime: Runtime): Promise<void> {
  if (state.mitmStartInProgress) return;
  state.mitmStartInProgress = true;
  try {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    if (!settings.mitmEnabled) return;
    const mitmStatus = await getMitmStatus();
    if (mitmStatus.running) return;

    const password = await loadEncryptedPassword();
    if (!password && process.platform !== "win32") return;

    const activeKey = runtime.repos.keys.getDefaultPublicKey()?.key || "sk_lobakai";
    await startServer(activeKey, password || "");
    if (!process.platform.startsWith("win")) setCachedPassword(password || "");
    try {
      await restoreToolDNS(password || "");
    } catch { /* DNS restore is best-effort */ }
  } catch { /* auto-start must never crash boot */ } finally {
    state.mitmStartInProgress = false;
  }
}

let initialized = false;

// Called once per process after the runtime is created (v1 runs this from the
// app layout bootstrap).
export function initializeApp(runtime: Runtime): void {
  if (initialized) return;
  initialized = true;
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const localPort = Number(runtime.config.port || 20129);

  if (settings.tunnelEnabled && !state.tunnelAutoResumed) {
    state.tunnelAutoResumed = true;
    enableCloudflareTunnel(runtime, localPort).catch(() => {});
    ensureCloudflared().catch(() => {});
  }
  if (settings.tailscaleEnabled && !state.tailscaleAutoResumed) {
    state.tailscaleAutoResumed = true;
    enableTailscaleTunnel(runtime, localPort).catch(() => {});
  }
  if (settings.mitmEnabled) {
    autoStartMitm(runtime).catch(() => {});
  }
  configureTunnelMonitoring(settings, runtime);
  startGrokCliAvailabilityProbe(runtime);
  configureQuotaAutoPing(runtime, settings);
  configureAutoclawTasks(runtime, settings);
  configureCodebuddyProbe(runtime, settings);
  startTokenRefreshScheduler(runtime);
  runtime.quotaSnapshots.start();
  syncModelCatalog(runtime);
}

export function shutdownAppInit(): void {
  stopGrokCliAvailabilityProbe();
  stopQuotaAutoPing();
  stopAutoclawTasks();
  stopCodebuddyProbe();
  stopTokenRefreshScheduler();
  // The process owns one quota scheduler.
  // Runtime shutdown stops the scheduler before SQLite closes.
}
