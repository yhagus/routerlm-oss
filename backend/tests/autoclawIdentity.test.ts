import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-autoclaw-identity-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => installFetchMock(null));

describe("AutoClaw account identity", () => {
  test("uses the profile email to reuse an existing AutoClaw connection", async () => {
    const instance = await runtime();
    try {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      installFetchMock(async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/userapi/v1/refresh")) {
          return Response.json({ code: 0, data: { access_token: "access-token", refresh_token: "rotated-refresh" } });
        }
        if (url.endsWith("/userapi/v1/user-profile")) {
          return Response.json({ code: 0, data: { user_id: "account-id", email: "owner@example.test" } });
        }
        return new Response("not found", { status: 404 });
      });
      const app = createApp(instance);
      const create = () => app.request("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "autoclaw", apiKey: "refresh-token", data: { deviceId: "device-id" } }),
      });

      const first = await create();
      expect(first.status).toBe(201);
      const firstConnection = (await first.json()).connection;
      expect(firstConnection).toMatchObject({ email: "owner@example.test", name: "owner@example.test" });

      const second = await create();
      expect(second.status).toBe(200);
      expect((await second.json()).connection.id).toBe(firstConnection.id);
      expect(instance.repos.providers.select("autoclaw")).toHaveLength(1);

      const profileCall = calls.find((call) => call.url.endsWith("/userapi/v1/user-profile"));
      expect(new Headers(profileCall?.init?.headers).get("authorization")).toBe("Bearer access-token");
      expect(profileCall?.init?.body).toBe(JSON.stringify({ source_id: "autoclaw", device_id: "device-id" }));
    } finally {
      instance.close();
    }
  });
  test("a connection test refreshes once, keeps the rotated refresh token, and backfills the identity", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "autoclaw",
        authType: "apikey",
        data: { refreshToken: "refresh-1", deviceId: "device-id", accessToken: "access-0" },
      });
      // The Provider rotates the refresh token: each one works once.
      let validRefresh = "refresh-1";
      let validAccess = "access-0";
      let refreshCalls = 0;
      const profileTokens: string[] = [];
      installFetchMock(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/userapi/v1/refresh")) {
          refreshCalls += 1;
          const sent = JSON.parse(String(init?.body)).refresh_token;
          if (sent !== validRefresh) return Response.json({ code: 401, msg: "refresh token reused" });
          validRefresh = `refresh-${refreshCalls + 1}`;
          validAccess = `access-${refreshCalls}`;
          return Response.json({ code: 0, data: { access_token: validAccess, refresh_token: validRefresh } });
        }
        if (url.endsWith("/userapi/v1/user-profile")) {
          const token = String(new Headers(init?.headers).get("authorization")).replace("Bearer ", "");
          profileTokens.push(token);
          if (token !== validAccess) return Response.json({ code: 401 });
          return Response.json({ code: 0, data: { user_id: "account-id", email: "owner@example.test" } });
        }
        return new Response("not found", { status: 404 });
      });

      const response = await createApp(instance).request(`/api/providers/${connection.id}/test`, { method: "POST" });
      expect((await response.json()).valid).toBe(true);

      expect(refreshCalls).toBe(1);
      expect(profileTokens).toEqual(["access-1"]);
      const stored = instance.repos.providers.get(connection.id)!;
      expect(stored.data.refreshToken).toBe("refresh-2");
      expect(stored.data.accessToken).toBe("access-1");
      expect(stored.email).toBe("owner@example.test");
    } finally {
      instance.close();
    }
  });
});
