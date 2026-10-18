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

  test("participants join an event through its public link and inherit its policy", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const created = await app.request("/api/keys", json({ name: "Hackathon", visibility: "event", maxConcurrency: 5 }));
      expect(created.status).toBe(201);
      const event = await created.json() as { id: string; key: string | null };
      expect(event.key).toBeNull();
      // The parent's placeholder secret never authenticates.
      const placeholder = instance.repos.keys.getSecret(event.id)!;
      expect(instance.repos.keys.getByKey(placeholder)).toBeNull();
      expect((await app.request(`/api/keys/${event.id}/secret`)).status).toBe(400);

      const info = await app.request(`/api/public/events/${event.id}`);
      expect(await info.json()).toEqual({ id: event.id, name: "Hackathon", participants: 0 });

      const joined = await app.request(`/api/public/events/${event.id}/keys`, json({ name: "Alice" }));
      expect(joined.status).toBe(201);
      const alice = await joined.json() as { key: string };
      // Names are unique per event regardless of case.
      expect((await app.request(`/api/public/events/${event.id}/keys`, json({ name: " alice " }))).status).toBe(409);
      expect((await app.request(`/api/public/events/${event.id}/keys`, json({ name: "  " }))).status).toBe(400);

      // A parent policy edit reaches the participant key without touching it.
      await app.request(`/api/keys/${event.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ comboAccessMode: "whitelist", comboAccessList: ["comboA"] }) });
      const resolved = instance.repos.keys.getByKey(alice.key)!;
      expect(resolved.comboAccessMode).toBe("whitelist");
      expect(resolved.comboAccessList).toEqual(["comboA"]);
      expect(resolved.maxConcurrency).toBe(5);

      // Participants stay out of the top-level key list but show in the event.
      const list = await (await app.request("/api/keys?visibility=event")).json() as { keys: Array<{ id: string; childCount: number }> };
      expect(list.keys.map((key) => key.id)).toEqual([event.id]);
      expect(list.keys[0].childCount).toBe(1);
      const children = await (await app.request(`/api/keys/${event.id}/children`)).json() as { keys: Array<{ name: string; key?: string }> };
      expect(children.keys.map((key) => key.name)).toEqual(["Alice"]);
      expect(children.keys[0].key).toBeUndefined();

      // A participant key does not accept its own policy.
      const participantId = instance.repos.keys.listChildren(event.id)[0].id;
      const policyEdit = await app.request(`/api/keys/${participantId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ limitMode: "requests", limitValue: 3 }) });
      expect(policyEdit.status).toBe(400);

      // Pausing the event closes the link and disables every participant key.
      await app.request(`/api/keys/${event.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: false }) });
      expect(instance.repos.keys.getByKey(alice.key)).toBeNull();
      expect((await app.request(`/api/public/events/${event.id}`)).status).toBe(404);
      expect((await app.request(`/api/public/events/${event.id}/keys`, json({ name: "Bob" }))).status).toBe(404);

      // Deleting the event deletes its participants.
      expect((await app.request(`/api/keys/${event.id}`, { method: "DELETE" })).status).toBe(200);
      expect(instance.repos.keys.list()).toHaveLength(0);
    } finally {
      instance.close();
    }
  });

  test("public event routes reject keys that are not event parents", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const privateKey = instance.repos.keys.create({ name: "Private", key: "sk-private", visibility: "private" }).record;
      expect((await app.request(`/api/public/events/${privateKey.id}`)).status).toBe(404);
      expect((await app.request("/api/public/events/missing")).status).toBe(404);
    } finally {
      instance.close();
    }
  });

  test("schema 22 turns old event keys into private keys", async () => {
    const { Database } = await import("bun:sqlite");
    const { applyMigrations } = await import("../src/db/migrate");
    const sqlite = new Database(":memory:");
    try {
      applyMigrations(sqlite);
      sqlite.query("INSERT INTO apiKeys (id, key, name, visibility, createdAt) VALUES ('old', 'sk-old', 'Old event', 'event', ?)").run(new Date().toISOString());
      sqlite.query("UPDATE _meta SET value = '21' WHERE key = 'schemaVersion'").run();
      applyMigrations(sqlite);
      expect(sqlite.query("SELECT visibility FROM apiKeys WHERE id = 'old'").get()).toEqual({ visibility: "private" });
      // A current database keeps its event parents.
      sqlite.query("UPDATE apiKeys SET visibility = 'event' WHERE id = 'old'").run();
      applyMigrations(sqlite);
      expect(sqlite.query("SELECT visibility FROM apiKeys WHERE id = 'old'").get()).toEqual({ visibility: "event" });
    } finally {
      sqlite.close();
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
