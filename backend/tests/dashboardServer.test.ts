import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardFetch } from "../src/dashboardServer";

const dist = mkdtempSync(join(tmpdir(), "lobakai-dashboard-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), "<html>dashboard</html>");
writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
writeFileSync(join(dist, "logo.svg"), "<svg/>");
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const seen: string[] = [];
const serve = createDashboardFetch(dist, (request) => {
  seen.push(new URL(request.url).pathname);
  return new Response("api");
});
const get = (path: string, init?: RequestInit) => Promise.resolve(serve(new Request(`http://localhost:20130${path}`, init)));

describe("dashboard server", () => {
  test("hands API paths to the gateway app", async () => {
    for (const path of ["/api/providers", "/v1/models", "/v1beta/models", "/responses", "/codex/responses"]) {
      expect(await (await get(path, { method: "POST" })).text()).toBe("api");
    }
    expect(seen).toEqual(["/api/providers", "/v1/models", "/v1beta/models", "/responses", "/codex/responses"]);
  });

  test("serves built files, caching fingerprinted assets", async () => {
    const asset = await get("/assets/app-abc123.js");
    expect(await asset.text()).toBe("console.log(1)");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const logo = await get("/logo.svg");
    expect(await logo.text()).toBe("<svg/>");
    expect(logo.headers.get("cache-control")).toBe("no-cache");
  });

  test("falls back to index.html for client routes and never leaves the dist folder", async () => {
    expect(await (await get("/dashboard/providers/zenmux")).text()).toBe("<html>dashboard</html>");
    expect(await (await get("/apix")).text()).toBe("<html>dashboard</html>");
    // The URL parser already collapses "/../"; an encoded slash survives it.
    expect((await get("/..%2f..%2fetc%2fpasswd")).status).toBe(404);
  });

  test("rejects writes outside the API", async () => {
    expect((await get("/dashboard", { method: "POST" })).status).toBe(405);
  });
});
