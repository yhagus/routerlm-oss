import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-api-keys-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("v1 endpoint API-key contracts", () => {
  test("supports visibility filtering, usage totals, features, limits, and resets", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const privateResponse = await app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Private key", customKey: "", visibility: "private", limitMode: "requests", limitValue: 12 }),
      });
      expect(privateResponse.status).toBe(201);
      const privateBody = await privateResponse.json() as { id: string; key: string };
      const publicResponse = await app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Public key", visibility: "public", isDefault: true }),
      });
      expect(publicResponse.status).toBe(201);
      const publicBody = await publicResponse.json() as { id: string };

      instance.repos.usage.record({ apiKey: privateBody.key, provider: "openai", model: "gpt-test", promptTokens: 10, completionTokens: 5, tokens: { prompt_tokens: 10, completion_tokens: 5 } });
      const listed = await app.request("/api/keys?page=1&pageSize=10&visibility=private&search=private");
      const listedBody = await listed.json() as { keys: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
      expect(listedBody.pagination).toEqual({ page: 1, pageSize: 10, totalItems: 1, totalPages: 1 });
      expect(listedBody.keys[0].usage).toEqual(expect.objectContaining({ requests: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15 }));

      const featureUpdate = await app.request(`/api/keys/${publicBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features: { quotaTracker: { enabled: true, provider: "codebuddy-intl-cli" } } }),
      });
      expect((await featureUpdate.json()).key.features).toEqual({ quotaTracker: { enabled: true, provider: "codebuddy-intl-cli" } });

      instance.repos.keys.incrementUsage(privateBody.id, 15);
      const reset = await app.request(`/api/keys/${privateBody.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resetUsage: true }),
      });
      expect((await reset.json()).key).toEqual(expect.objectContaining({ usageRequests: 0, usageTokens: 0, limitMode: "requests", limitValue: 12 }));
      expect(instance.repos.keys.getByKey(privateBody.key)?.usageRequests).toBe(0);
    } finally {
      instance.close();
    }
  });

  test("keeps public defaults exclusive and blocks private defaults", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const privateKey = instance.repos.keys.create({ name: "Private", key: "sk-private" }).record;
      const blocked = await app.request(`/api/keys/${privateKey.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      expect(blocked.status).toBe(400);

      const first = instance.repos.keys.create({ name: "First public", key: "sk-public-one", visibility: "public" }).record;
      const second = instance.repos.keys.create({ name: "Second public", key: "sk-public-two", visibility: "public" }).record;
      const selected = await app.request(`/api/keys/${second.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      expect((await selected.json()).key.isDefault).toBe(true);
      expect(instance.repos.keys.list().find((key) => key.id === first.id)?.isDefault).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("enforces per-second and per-minute rate limits via the gateway gate", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ requireApiKey: true });
      const key = instance.repos.keys.create({ name: "Limited", key: "sk-limited", features: { requestsPerSecond: 2 } }).record;
      const requestWith = (k: string) => new Request("http://local/v1/chat/completions", { headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, method: "POST", body: JSON.stringify({ model: "openai/gpt-test", messages: [{ role: "user", content: "hi" }] }) });
      const gate = instance.auth.gatewayRequestGate;

      expect(await gate(requestWith("sk-limited"))).toBeNull();
      expect(await gate(requestWith("sk-limited"))).toBeNull();
      const blocked = await gate(requestWith("sk-limited"));
      expect(blocked?.status).toBe(429);
    } finally {
      instance.close();
    }
  });

  test("runs the event key lifecycle draft → submitted → revoked", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Event key", visibility: "event", maxConcurrency: 5 }),
      });
      expect(created.status).toBe(201);
      const body = await created.json() as { id: string; key: string; status: string; maxConcurrency: number };
      expect(body.status).toBe("draft");
      expect(body.maxConcurrency).toBe(5);

      // A draft is not active: the key lookup used by the gateway rejects it.
      expect(instance.repos.keys.getByKey(body.key)).toBeNull();

      // Revoking a draft is invalid.
      const earlyRevoke = await app.request(`/api/keys/${body.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      expect(earlyRevoke.status).toBe(400);

      // Draft config is still editable.
      const edit = await app.request(`/api/keys/${body.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionPins: { comboA: { "openai/gpt": ["conn-1"] } } }),
      });
      expect(edit.status).toBe(200);

      // Submit activates the key.
      const submitted = await app.request(`/api/keys/${body.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      expect(submitted.status).toBe(200);
      expect((await submitted.json()).key.status).toBe("submitted");
      expect(instance.repos.keys.getByKey(body.key)?.status).toBe("submitted");

      // A submitted key is locked: config edits are rejected.
      const locked = await app.request(`/api/keys/${body.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limitMode: "requests", limitValue: 10 }),
      });
      expect(locked.status).toBe(403);

      // A submitted key cannot be deleted.
      const deleteSubmitted = await app.request(`/api/keys/${body.id}`, { method: "DELETE" });
      expect(deleteSubmitted.status).toBe(403);

      // Revoke deactivates it permanently.
      const revoked = await app.request(`/api/keys/${body.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      expect(revoked.status).toBe(200);
      expect((await revoked.json()).key.status).toBe("revoked");
      expect(instance.repos.keys.getByKey(body.key)).toBeNull();

      // A revoked key cannot be changed or deleted.
      const changeRevoked = await app.request(`/api/keys/${body.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      expect(changeRevoked.status).toBe(403);
      const deleteRevoked = await app.request(`/api/keys/${body.id}`, { method: "DELETE" });
      expect(deleteRevoked.status).toBe(403);
    } finally {
      instance.close();
    }
  });

  test("allows deleting a draft event key", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const draft = instance.repos.keys.create({ name: "Draft", key: "sk-draft", visibility: "event", status: "draft", isActive: false }).record;
      const response = await app.request(`/api/keys/${draft.id}`, { method: "DELETE" });
      expect(response.status).toBe(200);
      expect(instance.repos.keys.list().find((key) => key.id === draft.id)).toBeUndefined();
    } finally {
      instance.close();
    }
  });

  test("narrows the connection pool to the event key's pins", async () => {
    const { pinnedConnectionIds } = await import("../src/services/chat/gateway");
    const base = { visibility: "event", connectionPins: { comboA: { "openai/gpt": ["conn-1", "conn-2"] } } } as any;
    expect(pinnedConnectionIds(base, "comboA", "openai/gpt")).toEqual(["conn-1", "conn-2"]);
    // No pin for the pair leaves the pool untouched.
    expect(pinnedConnectionIds(base, "comboA", "openai/other")).toBeNull();
    expect(pinnedConnectionIds(base, "comboB", "openai/gpt")).toBeNull();
    // Non-event keys and standalone models never pin.
    expect(pinnedConnectionIds({ ...base, visibility: "public" }, "comboA", "openai/gpt")).toBeNull();
    expect(pinnedConnectionIds(base, null, "openai/gpt")).toBeNull();
    expect(pinnedConnectionIds(null, "comboA", "openai/gpt")).toBeNull();
  });
});
