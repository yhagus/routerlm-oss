import { Hono } from "hono";
import type { Context } from "hono";
import type { Runtime } from "../runtime";
import { publicModels } from "../services/providers/modelCatalog";
import { getProviderMetadata } from "../services/providers/providerCatalog";
import { connectionApiKey, elevenlabsVoices, deepgramVoices, genericVoices, inworldVoices } from "../services/media/voiceCatalog";
import { errorResponse } from "../services/media/shared";
import { handleMediaSearch } from "../services/media/search";
import { handleMediaFetch } from "../services/media/webFetch";
import { handleMediaEmbeddings } from "../services/media/embeddings";
import { handleMediaStt } from "../services/media/stt";
import { handleMediaTts } from "../services/media/tts";
import { handleMediaImages } from "../services/media/images";
import { dispatchChat } from "../services/chat/chat";
import { withAdmission } from "../services/chat/admission";
import type { GatewayErrorSource } from "../services/chat/gatewayError";
import type { ApiKeyRecord } from "../db/repositories";

// Providers whose /v1/audio/voices model ids are usable with /v1/audio/speech.
const VOICE_PROVIDER_ALIASES: Record<string, string | null> = {
  elevenlabs: null,
  deepgram: null,
  inworld: null,
  "edge-tts": null,
  "local-device": null,
};

export function gatewayRoutes(runtime: Runtime) {
  const app = new Hono();
  app.use("*", runtime.auth.gatewayMiddleware());
  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    await next();
  });
  app.options("/*", (c) => c.body(null, 204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }));
  const models = async (request: Request, kind = "llm") => publicModels(runtime, await runtime.auth.apiKeyFromRequest(request), kind);
  app.get("/", async (c) => c.json({ object: "list", data: await models(c.req.raw) }));
  app.get("/models", async (c) => c.json({ object: "list", data: await models(c.req.raw) }));
  app.get("/models/info", async (c) => {
    const id = c.req.query("id");
    const model = (await models(c.req.raw)).find((entry) => entry.id === id);
    return model ? c.json({ ...model, endpoint: "/v1/chat/completions" }) : c.json({ error: { message: `Model not found: ${id}`, type: "not_found" } }, 404);
  });
  app.get("/models/:kind", async (c) => {
    // v1 KIND_SLUG_MAP has no "chat" slug — the bare /v1/models list serves LLMs.
    const kind = c.req.param("kind");
    const map: Record<string, string> = { image: "image", tts: "tts", stt: "stt", embedding: "embedding", "image-to-text": "imageToText", web: "webSearch" };
    if (!map[kind]) return c.json({ error: { message: `Unknown model kind: ${kind}. Supported: image, tts, stt, embedding, image-to-text, web`, type: "invalid_request_error" } }, 404);
    return c.json({ object: "list", data: await models(c.req.raw, map[kind]) });
  });
  // GET /v1/audio/voices?provider={p}[&lang=xx] — OpenAI-style list where each
  // voice's model id is ready for /v1/audio/speech.
  app.get("/audio/voices", async (c) => {
    try {
      const provider = c.req.query("provider");
      const lang = c.req.query("lang");
      if (!provider || !(provider in VOICE_PROVIDER_ALIASES)) {
        return c.json({ error: { message: `provider must be one of: ${Object.keys(VOICE_PROVIDER_ALIASES).join(", ")}`, type: "invalid_request_error" } }, 400);
      }
      let payload: { voices?: Array<Record<string, unknown>>; byLang?: Record<string, { voices: Array<Record<string, unknown>> }> };
      if (provider === "elevenlabs" || provider === "deepgram" || provider === "inworld") {
        const apiKey = connectionApiKey(runtime, provider);
        if (!apiKey) return c.json({ error: { message: `No ${provider} connection found`, type: "server_error" } }, 400);
        payload = provider === "elevenlabs" ? await elevenlabsVoices(apiKey, lang) : provider === "deepgram" ? await deepgramVoices(apiKey, lang) : await inworldVoices(apiKey, lang);
      } else {
        payload = await genericVoices(provider, lang);
      }
      const rawVoices = lang ? (payload.voices || []) : Object.values(payload.byLang || {}).flatMap((group) => group.voices || []);
      const alias = getProviderMetadata(provider)?.alias || provider;
      return c.json({ object: "list", data: rawVoices.map((voice) => ({
        id: voice.id,
        name: voice.name,
        lang: voice.lang || "",
        gender: voice.gender || "",
        model: `${alias}/${voice.id}`,
      })) });
    } catch (error: any) {
      return c.json({ error: { message: error instanceof Error ? error.message : "Failed", type: "server_error" } }, 502);
    }
  });
  app.post("/messages/count_tokens", async (c) => c.json({ input_tokens: runtime.gateway.countTokens(await c.req.json<Record<string, unknown>>()) }));
  // Chat and media routes: the API key gate, then admission control (global
  // in-flight cap and per-key concurrency limit), then the handler. The
  // admission slots return when the response body ends or the client cancels.
  const admitted = (source: GatewayErrorSource, handle: (c: Context, apiKey: ApiKeyRecord | null) => Promise<Response>) => async (c: Context) => {
    const gate = await runtime.auth.gatewayRequestGate(c.req.raw);
    if (gate) return gate;
    const apiKey = await runtime.auth.apiKeyFromHeaders(c.req.raw.headers);
    return withAdmission(runtime, apiKey, source, () => handle(c, apiKey));
  };
  // Chat surfaces try the specialized-executor path first (combos, executors,
  // account strategies); null falls through to the generic gateway path.
  const chat = (source: "openai" | "claude" | "responses" | "ollama", endpoint: string) => admitted(source, async (c, apiKey) => {
    const body = await c.req.json();
    // v1 clientRawRequest.headers is a lowercase key/value object.
    const headers = Object.fromEntries([...c.req.raw.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    const dispatched = await dispatchChat(runtime, { body, source, endpoint, pathname: new URL(c.req.url).pathname, apiKey, clientIp: c.req.header("x-forwarded-for"), headers, userAgent: c.req.header("user-agent") || "", signal: c.req.raw.signal });
    return dispatched || await runtime.gateway.chat({ body, source, endpoint, apiKey, clientIp: c.req.header("x-forwarded-for") });
  });
  app.post("/chat/completions", chat("openai", "/v1/chat/completions"));
  app.post("/", chat("responses", "/v1/responses"));
  app.post("/messages", chat("claude", "/v1/messages"));
  app.post("/responses", chat("responses", "/v1/responses"));
  app.post("/responses/compact", async (c) => {
    const apiKey = await runtime.auth.apiKeyFromHeaders(c.req.raw.headers);
    return withAdmission(runtime, apiKey, "responses", async () => {
      const body = await c.req.json<Record<string, unknown>>();
      body._compact = true;
      const headers = Object.fromEntries([...c.req.raw.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
      const dispatched = await dispatchChat(runtime, { body, source: "responses", endpoint: "/v1/responses", pathname: new URL(c.req.url).pathname, apiKey, clientIp: c.req.header("x-forwarded-for"), headers, userAgent: c.req.header("user-agent") || "", signal: c.req.raw.signal });
      return dispatched || runtime.gateway.chat({ body, source: "responses", endpoint: "/v1/responses", apiKey, clientIp: c.req.header("x-forwarded-for") });
    });
  });
  app.post("/api/chat", chat("ollama", "/v1/api/chat"));
  app.post("/embeddings", admitted("openai", async (c, apiKey) => handleMediaEmbeddings(runtime, { body: await c.req.json(), apiKey, clientIp: c.req.header("x-forwarded-for") })));
  app.post("/images/generations", admitted("openai", async (c, apiKey) => handleMediaImages(runtime, { body: await c.req.json(), binaryOutput: c.req.query("response_format") === "binary", stream: c.req.query("stream") === "true", apiKey, clientIp: c.req.header("x-forwarded-for") })));
  app.post("/audio/speech", admitted("openai", async (c, apiKey) => handleMediaTts(runtime, {
    body: await c.req.json(),
    responseFormat: c.req.query("response_format") || "mp3",
    apiKey,
    clientIp: c.req.header("x-forwarded-for"),
  })));
  app.post("/search", admitted("openai", async (c, apiKey) => handleMediaSearch(runtime, { body: await c.req.json(), apiKey, clientIp: c.req.header("x-forwarded-for") })));
  app.post("/web/fetch", admitted("openai", async (c, apiKey) => handleMediaFetch(runtime, { body: await c.req.json(), apiKey, clientIp: c.req.header("x-forwarded-for") })));
  // v1 has no deep routes under /v1/models — unmatched paths 404 like Next.
  app.all("/models/*", (c) => c.json({ error: { message: `Unknown model kind: ${c.req.path.split("/models/")[1] || ""}`, type: "invalid_request_error" } }, 404));
  app.post("/audio/transcriptions", admitted("openai", async (c, apiKey) => {
    try {
      const formData = await c.req.raw.formData();
      return await handleMediaStt(runtime, { formData, apiKey, clientIp: c.req.header("x-forwarded-for") });
    } catch {
      return errorResponse(400, "Invalid multipart form data");
    }
  }));
  return app;
}
