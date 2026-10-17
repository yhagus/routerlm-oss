import { defaultDataDir } from "../services/platform/dataDir.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { createSseResponse } from "../services/common/sse";
import { dispatchChat } from "../services/chat/chat";
import { getV2Executor } from "../services/chat/executors";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../services/chat/credentials";
import {
  detectTranslatorFormat,
  splitModel,
  targetFormatForConnection,
  targetHeaders,
  targetUrl,
  translateFromOpenAi,
  translateToOpenAi,
  unwrapBody,
} from "../services/chat/translator";

const ALLOWED_FILES = new Set([
  "1_req_client.json",
  "2_req_source.json",
  "3_req_openai.json",
  "4_req_target.json",
  "5_res_provider.txt",
  "6_res_openai.txt",
  "7_res_client.txt",
  "7_res_client.json",
]);

function translatorDirectory(runtime: Runtime): string {
  return join(runtime.config.dataDir || defaultDataDir(), "logs", "translator");
}

function jsonBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function modelParts(value: unknown): { provider: string; model: string } {
  const parts = splitModel(value);
  return { provider: parts.provider, model: parts.model };
}

function redactedHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers as Record<string, any>);
  return Object.fromEntries(entries.filter(([, value]) => value != null && String(value) !== "").map(([name, value]) => [
    name.toLowerCase(),
    /^(authorization|x-api-key|api-key|x-goog-api-key|cookie)$/i.test(name) ? "[configured]" : String(value),
  ]));
}

function executorCredentials(runtime: Runtime, connection: ReturnType<Runtime["repos"]["providers"]["select"]>[number]): Record<string, any> {
  const providerSpecificData = resolveV1ProviderSpecificData(connection.data);
  return {
    ...connection.data,
    authType: connection.authType,
    baseUrl: connection.baseUrl ?? connection.data.baseUrl ?? null,
    connectionId: connection.id,
    connectionName: connection.name || connection.email || connection.id,
    providerSpecificData: {
      ...providerSpecificData,
      ...(connection.baseUrl || connection.data.baseUrl ? { baseUrl: connection.baseUrl || connection.data.baseUrl } : {}),
      ...resolveConnectionProxyConfig(runtime, providerSpecificData),
    },
  };
}

export function translatorRoutes(runtime: Runtime) {
  const app = new Hono();
  app.use("*", runtime.auth.adminMiddleware());

  app.post("/translate", async (c) => {
    const input = jsonBody(await c.req.json().catch(() => ({})));
    const step = Number(input.step);
    if (![1, 2, 3].includes(step) || input.body == null) return c.json({ success: false, error: "Step and body required" }, 400);

    try {
      if (step === 1) {
        const body = unwrapBody(jsonBody(input.body));
        const { provider, model } = modelParts(body.model);
        const connection = runtime.repos.providers.select(provider, model)[0] || null;
        return c.json({ success: true, result: { provider, model, sourceFormat: detectTranslatorFormat(body), targetFormat: targetFormatForConnection(provider, connection) } });
      }

      if (step === 2) {
        const body = unwrapBody(jsonBody(input.body));
        const { model } = modelParts(body.model);
        if (!model) return c.json({ success: false, error: "A model is required" }, 400);
        return c.json({ success: true, result: { body: translateToOpenAi(body, model, body.stream !== false) } });
      }

      const wrapper = jsonBody(input.body);
      const body = unwrapBody(wrapper);
      const provider = typeof wrapper.provider === "string" ? wrapper.provider : "";
      const model = typeof wrapper.model === "string" ? wrapper.model : String(body.model || "");
      if (!provider || !model) return c.json({ success: false, error: "provider and model required" }, 400);
      const connection = runtime.repos.providers.select(provider, model)[0] || null;
      if (!connection) return c.json({ success: false, error: `No active connection for provider: ${provider}` }, 400);
      const target = targetFormatForConnection(provider, connection);
      const stream = body.stream !== false;
      const translated = translateFromOpenAi(body, target, model, stream);
      const executor = getV2Executor(provider);
      if (executor?.buildUrl && executor.buildHeaders && executor.transformRequest) {
        const credentials = executorCredentials(runtime, connection);
        const transformed = await executor.transformRequest(model, translated, stream, credentials);
        const url = executor.buildUrl(model, stream, 0, credentials);
        const headers = executor.buildHeaders(credentials, stream, url);
        return c.json({ success: true, result: { url, headers: redactedHeaders(headers), body: transformed, capability: { headersRedacted: true, providerSpecificExecutor: true } } });
      }
      const url = targetUrl(connection, target, model);
      if (!url) return c.json({ success: false, error: `Provider ${provider} has no base URL` }, 400);
      return c.json({ success: true, result: { url, headers: targetHeaders(connection, target), body: translated, capability: { headersRedacted: true, providerSpecificExecutor: false } } });
    } catch (error: any) {
      return c.json({ success: false, error: error instanceof Error ? error.message : "Translation failed" }, 500);
    }
  });

  app.post("/send", async (c) => {
    const input = jsonBody(await c.req.json().catch(() => ({})));
    const provider = typeof input.provider === "string" ? input.provider : "";
    const model = typeof input.model === "string" ? input.model : "";
    const body = jsonBody(input.body);
    if (!provider || !model || !Object.keys(body).length) return c.json({ success: false, error: "provider, model, and body required" }, 400);
    const connection = runtime.repos.providers.select(provider, model)[0] || null;
    if (!connection) return c.json({ success: false, error: `No active connection for provider: ${provider}` }, 400);
    const requestedModel = model.includes("/") ? model : `${provider}/${model}`;
    const target = targetFormatForConnection(provider, connection);
    const source = target === "claude" ? "claude" : target === "openai-responses" ? "responses" : "openai";
    const endpoint = source === "claude" ? "/v1/messages" : source === "responses" ? "/v1/responses" : "/v1/chat/completions";
    const apiKey = await runtime.auth.apiKeyFromHeaders(c.req.raw.headers);
    const headers = Object.fromEntries([...c.req.raw.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    const response = await dispatchChat(runtime, {
      body: { ...body, model: requestedModel },
      source,
      endpoint,
      pathname: new URL(c.req.url).pathname,
      apiKey,
      clientIp: c.req.header("x-forwarded-for"),
      headers,
      userAgent: c.req.header("user-agent") || "",
      signal: c.req.raw.signal,
    }) || await runtime.gateway.chat({ body: { ...body, model: requestedModel }, source, endpoint, apiKey, clientIp: c.req.header("x-forwarded-for") });
    if (!response.ok) {
      const text = await response.text();
      return c.json({ success: false, error: `Provider error: ${response.status}`, details: text }, response.status as 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504);
    }
    return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  });

  app.post("/save", async (c) => {
    const input = jsonBody(await c.req.json().catch(() => ({})));
    const file = typeof input.file === "string" ? input.file : "";
    if (!file || input.content === undefined) return c.json({ success: false, error: "File and content required" }, 400);
    if (!ALLOWED_FILES.has(file)) return c.json({ success: false, error: "Invalid file name" }, 400);
    try {
      const directory = translatorDirectory(runtime);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, file), String(input.content), "utf8");
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ success: false, error: error instanceof Error ? error.message : "Could not save file" }, 500);
    }
  });

  app.get("/load", async (c) => {
    const file = c.req.query("file") || "";
    if (!file) return c.json({ success: false, error: "File parameter required" }, 400);
    if (!ALLOWED_FILES.has(file)) return c.json({ success: false, error: "Invalid file name" }, 400);
    try {
      const content = await readFile(join(translatorDirectory(runtime), file), "utf8");
      return c.json({ success: true, content });
    } catch (error: any) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return c.json({ success: false, error: "File not found" }, 404);
      return c.json({ success: false, error: error instanceof Error ? error.message : "Could not load file" }, 500);
    }
  });

  app.get("/console-logs", (c) => c.json({ success: true, logs: runtime.consoleLogs.list() }));
  app.delete("/console-logs", (c) => {
    runtime.consoleLogs.clear();
    return c.json({ success: true });
  });
  app.get("/console-logs/stream", (c) => createSseResponse(c.req.raw, (writer) => {
    const logs = runtime.consoleLogs.list();
    if (logs.length) writer.data({ type: "init", logs });
    const unsubscribeLine = runtime.consoleLogs.subscribe("line", (line) => writer.data({ type: "line", line }));
    const unsubscribeClear = runtime.consoleLogs.subscribe("clear", () => writer.data({ type: "clear" }));
    const keepalive = setInterval(() => writer.comment("ping"), 25_000);
    keepalive.unref?.();
    return () => {
      unsubscribeLine();
      unsubscribeClear();
      clearInterval(keepalive);
    };
  }));

  return app;
}
