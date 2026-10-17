import { Hono } from "hono";
import type { Context } from "hono";
import type { Runtime } from "../runtime";
import { commandExists } from "../services/platform/host";
import { cloudflareTunnelStatus, disableCloudflareTunnel, disableTailscaleTunnel, enableCloudflareTunnel, enableTailscaleTunnel, getDownloadStatus, installTailscale, tailscaleCheck, tailscaleStatus } from "../services/platform/tunnelManager";

const DNS_WARMUP_DELAY_MS = 8_000;
const STATUS_CACHE_TTL_MS = 3_000;
let statusCache: { value: Record<string, unknown> | null; fetchedAt: number } = { value: null, fetchedAt: 0 };

export function tunnelRoutes(runtime: Runtime) {
  const backendPort = Number(runtime.config.port || process.env.PORT || 20129);

  const status = async () => {
    let probes = statusCache.value as { tunnel: unknown; tailscale: unknown } | null;
    if (!probes || Date.now() - statusCache.fetchedAt >= STATUS_CACHE_TTL_MS) {
      probes = { tunnel: await cloudflareTunnelStatus(runtime), tailscale: await tailscaleStatus(runtime) };
      statusCache = { value: probes, fetchedAt: Date.now() };
    }
    return { ...probes, download: getDownloadStatus() };
  };

  const enable = async (c: Context) => {
    try {
      const result = await enableCloudflareTunnel(runtime, backendPort);
      // DNS warmup at the Cloudflare edge after the tunnel registers.
      await new Promise<any>((resolve) => setTimeout(resolve, DNS_WARMUP_DELAY_MS));
      return c.json(result);
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Tunnel enable failed" }, 500);
    }
  };

  const disable = async (c: Context) => {
    try {
      return c.json(await disableCloudflareTunnel(runtime));
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Tunnel disable failed" }, 500);
    }
  };

  const tailscaleEnable = async (c: Context) => {
    try {
      const body = await c.req.json<{ sudoPassword?: string }>().catch(() => ({}) as { sudoPassword?: string });
      return c.json(await enableTailscaleTunnel(runtime, backendPort, body.sudoPassword || ""));
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Tailscale enable failed" }, 500);
    }
  };

  const tailscaleDisable = async (c: Context) => {
    try {
      return c.json(await disableTailscaleTunnel(runtime));
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Tailscale disable failed" }, 500);
    }
  };

  const check = async (c: Context) => {
    try {
      return c.json(await tailscaleCheck());
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Tailscale check failed" }, 500);
    }
  };

  const install = async (c: Context) => {
    const body = await c.req.json<{ sudoPassword?: string }>().catch(() => ({}) as { sudoPassword?: string });
    if (process.platform !== "win32" && !body.sudoPassword) {
      // Outside Windows the installer needs sudo unless brew can do it alone.
      const brewAvailable = process.platform === "darwin" && await commandExists("brew");
      if (!brewAvailable) return c.json({ error: "Sudo password is required" }, 400);
    }
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          const result = await installTailscale(body.sudoPassword || "", `v2-${crypto.randomUUID().slice(0, 6)}`, (message: string) => send("progress", { message }));
          send("done", result);
        } catch (error: any) {
          send("error", { error: error instanceof Error ? error.message : "Install failed" });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  };

  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/status", async (c) => {
      try {
        return c.json(await status());
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Tunnel status failed" }, 500);
      }
    })
    .post("/enable", enable)
    .post("/disable", disable)
    .get("/tailscale-check", check)
    .post("/tailscale-check", check)
    .post("/tailscale-install", install)
    .post("/tailscale-enable", tailscaleEnable)
    .post("/tailscale-disable", tailscaleDisable);
}
