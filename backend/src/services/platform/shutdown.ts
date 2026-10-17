// The one graceful shutdown. The entry point (main.ts) registers it: stop the
// server, stop schedulers, flush Usage and request details, close SQLite,
// then exit. Routes and services that must end the process (the updater, the
// shutdown routes) request it here and never call process.exit themselves.

export type ShutdownHandler = (reason: string) => void | Promise<void>;

let handler: ShutdownHandler | null = null;

export function setShutdownHandler(next: ShutdownHandler | null): void {
  handler = next;
}

// Starts the registered shutdown after `delayMs`, so the current HTTP
// response can reach the client first. Without a registered handler (tests,
// tools that embed the app) the request only logs.
export function requestShutdown(reason: string, delayMs = 0): void {
  setTimeout(() => {
    if (!handler) {
      console.warn(`[Backend] Shutdown requested (${reason}), but no shutdown handler is registered`);
      return;
    }
    void handler(reason);
  }, delayMs);
}
