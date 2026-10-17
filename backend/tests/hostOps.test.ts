import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-host-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("v2 host operation routes", () => {
  test("tunnel status and tailscale check report real probe results", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ tunnelEnabled: true, tunnelUrl: "https://x.trycloudflare.com" });
      const app = createApp(instance);
      const status = await app.request("/api/tunnel/status");
      expect(status.status).toBe(200);
      const payload = await status.json();
      expect(payload.tunnel).toMatchObject({ enabled: true, settingsEnabled: true, tunnelUrl: "https://x.trycloudflare.com" });
      expect(typeof payload.tunnel.running).toBe("boolean");
      expect(payload.download).toBeDefined();

      const check = await app.request("/api/tunnel/tailscale-check");
      const checkPayload = await check.json();
      expect(checkPayload.platform).toBe(process.platform);
      expect(typeof checkPayload.installed).toBe("boolean");
      expect(typeof checkPayload.loggedIn).toBe("boolean");
      expect(typeof checkPayload.systemDaemonRunning).toBe("boolean");

      // Disabling clears settings exactly like v1.
      const disabled = await app.request("/api/tunnel/disable", { method: "POST" });
      expect(await disabled.json()).toMatchObject({ success: true });
      expect((instance.repos.settings.get() as { tunnelEnabled?: boolean }).tunnelEnabled).toBe(false);
    } finally {
      instance.close();
    }
  }, 20000);

  test("pxpipe status reflects the real install state and settings", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ pxpipeEnabled: true, pxpipeMinChars: 12345 });
      const app = createApp(instance);
      const status = await app.request("/api/pxpipe/status");
      expect(status.status).toBe(200);
      const payload = await status.json();
      expect(payload.mode).toBe("library");
      expect(payload.enabled).toBe(true);
      expect(payload.minChars).toBe(12345);
      expect(typeof payload.installed).toBe("boolean");
      expect(typeof payload.npmAvailable).toBe("boolean");

      // Start without install and with auto-install off matches v1's 409.
      instance.repos.settings.update({ pxpipeAutoInstall: false });
      const blocked = await app.request("/api/pxpipe/start", { method: "POST" });
      if (!payload.installed) {
        expect(blocked.status).toBe(409);
        expect(await blocked.json()).toMatchObject({ code: "NOT_INSTALLED" });
      }

      const logs = await app.request("/api/pxpipe/logs");
      expect(await logs.json()).toMatchObject({ installLog: expect.any(String), events: expect.any(Array) });
      const stats = await app.request("/api/pxpipe/stats");
      expect((await stats.json()).windows).toBeDefined();
    } finally {
      instance.close();
    }
  });

  test("headroom status reports detection and rejects remote starts", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ headroomUrl: "https://headroom.example.test:8787" });
      const app = createApp(instance);
      const status = await app.request("/api/headroom/status");
      expect(status.status).toBe(200);
      const payload = await status.json();
      expect(typeof payload.installed).toBe("boolean");
      expect(payload.canStart).toBe(false);

      // A non-loopback URL can never be started locally (v1 EXTERNAL_PROXY).
      const start = await app.request("/api/headroom/start", { method: "POST" });
      expect(start.status).toBe(400);
      expect(await start.json()).toMatchObject({ code: "EXTERNAL_PROXY" });

      const stop = await app.request("/api/headroom/stop", { method: "POST" });
      expect([200, 409]).toContain(stop.status);
    } finally {
      instance.close();
    }
  });

  test("mitm status reads real state and alias routes enforce DNS gating", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const status = await app.request("/api/cli-tools/antigravity-mitm");
      expect(status.status).toBe(200);
      const payload = await status.json();
      expect(typeof payload.running).toBe("boolean");
      expect(typeof payload.certExists).toBe("boolean");
      expect(payload.dnsStatus).toBeDefined();
      expect(typeof payload.needsSudoPassword).toBe("boolean");

      const start = await app.request("/api/cli-tools/antigravity-mitm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      expect(start.status).toBe(400);
      expect((await start.json()).error).toBe("Missing apiKey");

      // DNS for the tool is disabled, so alias edits must be rejected.
      const aliasPut = await app.request("/api/cli-tools/antigravity-mitm/alias", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "antigravity", mappings: { "gemini-2.5-pro": "gemini-2.5-flash" } }) });
      if (!(payload.dnsStatus as Record<string, boolean>).antigravity) {
        expect(aliasPut.status).toBe(403);
      }

      const aliases = await app.request("/api/cli-tools/antigravity-mitm/alias?tool=antigravity");
      expect(await aliases.json()).toEqual({ aliases: { antigravity: {} } });
    } finally {
      instance.close();
    }
  });
});
