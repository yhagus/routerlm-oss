import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { dispatchChat } from "../services/chat/chat";
import { withAdmission } from "../services/chat/admission";

// Port of v1 src/app/api/v1beta/models/[...path]/route.js: Gemini-format
// requests convert to the internal OpenAI shape, run through the full chat
// dispatch (executors, combos, mutators), and responses convert back to the
// Gemini wire format — including SSE streams (no [DONE] sentinel).


/** Map OpenAI finish_reason => Gemini finishReason */
const FINISH_REASON_MAP: Record<string, string> = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

// Convert a Gemini request body to the internal OpenAI shape. Streaming intent
// comes from the URL action suffix, not a body field.
function convertGeminiToInternal(geminiBody: Record<string, any>, model: string, stream: boolean): Record<string, unknown> {
  const messages: Array<Record<string, string>> = [];
  if (geminiBody.systemInstruction) {
    const systemText = geminiBody.systemInstruction.parts?.map((part: Record<string, string>) => part.text).join("\n") || "";
    if (systemText) messages.push({ role: "system", content: systemText });
  }
  if (geminiBody.contents) {
    for (const content of geminiBody.contents) {
      const role = content.role === "model" ? "assistant" : "user";
      const text = content.parts?.map((part: Record<string, string>) => part.text).join("\n") || "";
      messages.push({ role, content: text });
    }
  }
  return {
    model,
    messages,
    stream,
    max_tokens: geminiBody.generationConfig?.maxOutputTokens,
    temperature: geminiBody.generationConfig?.temperature,
    top_p: geminiBody.generationConfig?.topP,
  };
}

// Transform an OpenAI SSE stream into a Gemini SSE stream. Gemini SSE ends by
// stream close — the OpenAI [DONE] sentinel is dropped.
function transformOpenAISSEToGeminiSSE(upstreamResponse: Response, model: string): Response {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let parsed: Record<string, any>;
        try { parsed = JSON.parse(data); } catch { continue; }
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        const parts: Array<Record<string, unknown>> = [];
        if (delta.reasoning_content) parts.push({ text: delta.reasoning_content, thought: true });
        if (delta.content) parts.push({ text: delta.content });
        if (parts.length === 0 && !choice.finish_reason) continue;
        const candidate: Record<string, unknown> = {
          content: { role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] },
          index: 0,
        };
        if (choice.finish_reason) candidate.finishReason = FINISH_REASON_MAP[choice.finish_reason] || "STOP";
        const geminiChunk: Record<string, unknown> = { candidates: [candidate] };
        if (choice.finish_reason && parsed.usage) {
          const usageMetadata: Record<string, unknown> = {
            promptTokenCount: parsed.usage.prompt_tokens || 0,
            candidatesTokenCount: parsed.usage.completion_tokens || 0,
            totalTokenCount: parsed.usage.total_tokens || 0,
          };
          const reasoningTokens = parsed.usage.completion_tokens_details?.reasoning_tokens;
          if (reasoningTokens) usageMetadata.thoughtsTokenCount = reasoningTokens;
          geminiChunk.usageMetadata = usageMetadata;
          geminiChunk.modelVersion = parsed.model || model;
        }
        controller.enqueue(encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n"));
      }
    },
  });
  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" },
  });
}

// Convert an OpenAI chat.completion JSON response into a Gemini
// GenerateContentResponse.
async function convertOpenAIResponseToGemini(response: Response, model: string): Promise<Response> {
  if (!response.ok) return response;
  let body: Record<string, any>;
  try { body = await response.json(); } catch { return response; }
  if (body.candidates) return Response.json(body, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  if (body.error) return Response.json(body, { status: response.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  const choice = body.choices?.[0];
  if (!choice) return Response.json(body, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  const { message, finish_reason } = choice;
  const parts: Array<Record<string, unknown>> = [];
  if (message.reasoning_content) parts.push({ text: message.reasoning_content, thought: true });
  parts.push({ text: message.content || "" });
  const geminiResponse: Record<string, unknown> = {
    candidates: [{ content: { role: "model", parts }, finishReason: FINISH_REASON_MAP[finish_reason] || "STOP", index: 0 }],
    modelVersion: body.model || model,
  };
  if (body.usage) {
    geminiResponse.usageMetadata = {
      promptTokenCount: body.usage.prompt_tokens || 0,
      candidatesTokenCount: body.usage.completion_tokens || 0,
      totalTokenCount: body.usage.total_tokens || 0,
    };
    const reasoningTokens = body.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoningTokens) (geminiResponse.usageMetadata as Record<string, unknown>).thoughtsTokenCount = reasoningTokens;
  }
  return Response.json(geminiResponse, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export function geminiRoutes(runtime: Runtime) {
  const app = new Hono();
  app.use("*", runtime.auth.gatewayMiddleware());
  app.use("*", async (c, next) => { c.header("Access-Control-Allow-Origin", "*"); c.header("Access-Control-Allow-Headers", "*"); c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); await next(); });
  app.options("/*", (c) => c.body(null, 204));
  // v1 returns 403 "Model listing is disabled" for the Gemini models list.
  app.get("/models", (c) => c.json({ error: { message: "Model listing is disabled", type: "forbidden" } }, 403));

  const generate = async (c: any) => {
    const path = c.req.path.split("/models/")[1] || "";
    const segments = path.split("/").filter(Boolean);
    // path = ["provider", "model:action"] or ["model:action"]
    let model: string;
    let action: string;
    const modelAction = segments[segments.length - 1] || "";
    action = modelAction.includes(":streamGenerateContent") ? ":streamGenerateContent" : ":generateContent";
    const modelName = modelAction.replace(":streamGenerateContent", "").replace(":generateContent", "");
    model = segments.length >= 2 ? `${segments.slice(0, -1).join("/")}/${modelName}` : modelName;

    if (!model || !/^[a-zA-Z0-9_.:/-]+$/.test(model)) return c.json({ error: { message: "Invalid Gemini model", type: "invalid_request_error" } }, 400);

    const body = await c.req.json().catch(() => ({})) as Record<string, any>;
    const stream = action === ":streamGenerateContent";
    const gate = await runtime.auth.gatewayRequestGate(c.req.raw);
    if (gate) return gate;
    const convertedBody = convertGeminiToInternal(body, model, stream);
    const apiKey = await runtime.auth.apiKeyFromHeaders(c.req.raw.headers);
    const headers = Object.fromEntries([...c.req.raw.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    return withAdmission(runtime, apiKey, "openai", async () => {
      const dispatched = await dispatchChat(runtime, { body: convertedBody, source: "openai", endpoint: "/v1beta/models", pathname: null, apiKey, clientIp: c.req.header("x-forwarded-for"), headers, userAgent: c.req.header("user-agent") || "", signal: c.req.raw.signal });
      const response = dispatched || await runtime.gateway.chat({ body: convertedBody, source: "openai", endpoint: "/v1/chat/completions", apiKey, clientIp: c.req.header("x-forwarded-for") });

      if (stream) return transformOpenAISSEToGeminiSSE(response, model);
      if (!response.ok) return response;
      return convertOpenAIResponseToGemini(response, model);
    });
  };
  app.post("/models/:modelAction", generate);
  app.post("/models/*", generate);
  return app;
}
