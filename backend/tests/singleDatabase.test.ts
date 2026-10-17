import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { getModelAliases, setModelAlias } from "../src/services/platform/db/repos/aliasRepo";
import { installFetchMock } from "./fetchHarness";

const roots: string[] = [];

afterEach(() => {
  installFetchMock(null);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = `/tmp/lobakai-single-db-${crypto.randomUUID()}`;
  roots.push(root);
  return root;
}

function runtimeAt(databasePath: string, dataDir: string) {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: databasePath,
    DATA_DIR: dataDir,
    REQUIRE_LOGIN: "false",
  }));
}

function mockMistralCompletion() {
  installFetchMock(async () => new Response(JSON.stringify({
    id: "single-db", object: "chat.completion", model: "mistral-large-latest",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
}

function postChat(app: ReturnType<typeof createApp>) {
  return app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: false, messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("single SQLite connection", () => {
  test("a chat request and a legacy alias write use the BACKEND_DATABASE_PATH file", async () => {
    const root = tempRoot();
    const dataDir = `${root}/data`;
    const databasePath = `${root}/custom/main.sqlite`;
    mockMistralCompletion();

    const first = await runtimeAt(databasePath, dataDir);
    try {
      first.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      const app = createApp(first);
      expect((await postChat(app)).status).toBe(200);
      await setModelAlias("single-db", "mistral/mistral-large-latest");
    } finally {
      first.close();
    }

    // A runtime on another file must not see the alias written above.
    const other = await runtimeAt(`${root}/other/other.sqlite`, dataDir);
    try {
      expect((await getModelAliases())["single-db"]).toBeUndefined();
    } finally {
      other.close();
    }

    const reopened = await runtimeAt(databasePath, dataDir);
    try {
      const app = createApp(reopened);
      expect((await getModelAliases())["single-db"]).toBe("mistral/mistral-large-latest");
      const history = (await (await app.request("/api/usage/history")).json() as { items: Array<Record<string, unknown>> }).items;
      expect(history.map((row) => row.provider)).toEqual(["mistral"]);
    } finally {
      reopened.close();
    }

    expect(existsSync(`${dataDir}/db/data.sqlite`)).toBe(false);
  });

  test("closing the runtime writes queued Usage rows and request details", async () => {
    const root = tempRoot();
    const databasePath = `${root}/main.sqlite`;
    mockMistralCompletion();

    const first = await runtimeAt(databasePath, `${root}/data`);
    try {
      first.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      expect((await postChat(createApp(first))).status).toBe(200);
    } finally {
      // Close at once: the Usage queue (1s) and request detail buffer (5s) are still pending.
      first.close();
    }

    const reopened = await runtimeAt(databasePath, `${root}/data`);
    try {
      const app = createApp(reopened);
      const history = (await (await app.request("/api/usage/history")).json() as { items: Array<Record<string, unknown>> }).items;
      expect(history).toHaveLength(1);
      expect(history[0].prompt_tokens).toBe(7);
      const details = await (await app.request("/api/usage/request-details")).json() as { details: Array<Record<string, unknown>> };
      expect(details.details.map((detail) => detail.provider)).toEqual(["mistral"]);
    } finally {
      reopened.close();
    }
  });
});
