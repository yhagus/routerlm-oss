import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, api, describeApiError } from "./api";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("describeApiError", () => {
  test("flags 401/403 as an expired session, not a network error", () => {
    expect(describeApiError(new ApiError(401, "Unauthorized"))).toBe(
      "Session expired — please sign in again.",
    );
    expect(describeApiError(new ApiError(403, "Forbidden"))).toBe(
      "Session expired — please sign in again.",
    );
  });

  test("surfaces other API errors with their server message", () => {
    expect(describeApiError(new ApiError(500, "Internal server error"))).toBe(
      "Internal server error",
    );
  });

  test("only calls a rejected fetch a network error", () => {
    expect(describeApiError(new TypeError("Failed to fetch"))).toContain(
      "Network error",
    );
  });
});

describe("management API client", () => {
  test("unwraps the backend management envelopes before views consume them", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ connections: [{ id: "provider-1" }] }))
      .mockResolvedValueOnce(json({ nodes: [{ id: "node-1" }] }))
      .mockResolvedValueOnce(json({ proxyPools: [{ id: "proxy-1" }] }))
      .mockResolvedValueOnce(json({ models: [{ id: "openai/gpt-test" }] }))
      .mockResolvedValueOnce(json({ aliases: { fast: "openai/gpt-test" } }))
      .mockResolvedValueOnce(json({ combos: [{ id: "combo-1" }] }))
      .mockResolvedValueOnce(json({ keys: [{ id: "key-1" }] }))
      .mockResolvedValueOnce(json({ details: [{ id: "request-1" }] }));
    vi.stubGlobal("fetch", fetch);

    await expect(api.providers.list()).resolves.toEqual([{ id: "provider-1" }]);
    await expect(api.nodes.list()).resolves.toEqual([{ id: "node-1" }]);
    await expect(api.proxies.list()).resolves.toEqual([{ id: "proxy-1" }]);
    await expect(api.models.list()).resolves.toEqual({
      object: "list",
      data: [{ id: "openai/gpt-test" }],
    });
    await expect(api.models.aliases()).resolves.toEqual({
      fast: "openai/gpt-test",
    });
    await expect(api.combos.list()).resolves.toEqual([{ id: "combo-1" }]);
    await expect(api.keys.list()).resolves.toEqual([{ id: "key-1" }]);
    await expect(api.usage.requestDetails()).resolves.toEqual({
      details: [{ id: "request-1" }],
    });
  });

  test("uses backend-compatible transport for aliases and custom models", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(
        json({ success: true, added: { id: "gpt-test" } }),
      );
    vi.stubGlobal("fetch", fetch);

    await api.models.deleteAlias("fast model");
    await api.models.saveCustom({
      provider: "openai",
      model: "gpt-test",
      kind: "chat",
    });

    expect(fetch.mock.calls[0][0]).toBe("/api/models/alias?alias=fast%20model");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      providerAlias: "openai",
      id: "gpt-test",
      type: "chat",
    });
  });

  test("converts provider validation into the UI success field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ valid: true, status: 204 })),
    );

    await expect(api.providers.test("provider-1")).resolves.toEqual({
      ok: true,
      valid: true,
      status: 204,
      error: undefined,
      refreshed: undefined,
    });
  });

  test("covers provider-detail diagnostics and model controls", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ overrides: { "model-1": 100000 } }))
      .mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal("fetch", fetch);

    await api.models.test("openai/model-1");
    await api.models.contextWindows("openai");
    await api.models.saveContextWindow("openai", "model-1", 100000);

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      model: "openai/model-1",
      kind: "llm",
    });
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: "PUT" });
  });

  test("uses the translator replay route contracts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: true, result: { provider: "openai" } }),
      )
      .mockResolvedValueOnce(json({ success: true, content: "{}" }))
      .mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      api.translator.translate(1, { model: "openai/gpt-test" }),
    ).resolves.toEqual({ success: true, result: { provider: "openai" } });
    await expect(api.translator.load("1_req_client.json")).resolves.toEqual({
      success: true,
      content: "{}",
    });
    await expect(
      api.translator.save("1_req_client.json", "{}"),
    ).resolves.toEqual({ success: true });

    expect(fetch.mock.calls[0][0]).toBe("/api/translator/translate");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      step: 1,
      body: { model: "openai/gpt-test" },
    });
    expect(fetch.mock.calls[1][0]).toBe(
      "/api/translator/load?file=1_req_client.json",
    );
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      file: "1_req_client.json",
      content: "{}",
    });
  });

  test("uses the bare model catalog for chat", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ object: "list", data: [] }));
    vi.stubGlobal("fetch", fetch);

    await api.gateway.models("chat");

    expect(fetch.mock.calls[0][0]).toBe("/v1/models");
  });

  test("uses authenticated dashboard routes for playground chat", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({ object: "list", data: [{ id: "openai/gpt-test" }] }),
      )
      .mockResolvedValueOnce(
        json({
          model: "openai/gpt-test",
          supportsSelection: true,
          accounts: [{ id: "account-1", label: "Primary" }],
        }),
      )
      .mockResolvedValueOnce(
        new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetch);

    await api.dashboardChat.models();
    await api.dashboardChat.accounts("openai/gpt-test");
    await api.dashboardChat.completions(
      "messages",
      { model: "openai/gpt-test", messages: [] },
      undefined,
      "account-1",
    );

    expect(fetch.mock.calls[0][0]).toBe("/api/dashboard/chat/models");
    expect(fetch.mock.calls[1][0]).toBe(
      "/api/dashboard/chat/accounts?model=openai%2Fgpt-test",
    );
    expect(fetch.mock.calls[2][0]).toBe(
      "/api/dashboard/chat/completions?format=messages",
    );
    const headers = new Headers(fetch.mock.calls[2][1].headers);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("x-connection-id")).toBe("account-1");
  });
});
