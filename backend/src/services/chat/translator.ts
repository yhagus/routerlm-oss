import type { ProviderConnection } from "../../db/repositories";

export type TranslatorFormat = "openai" | "openai-responses" | "claude" | "gemini";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function unwrapBody(value: Record<string, unknown>): Record<string, unknown> {
  return record(value.body || value);
}

export function detectTranslatorFormat(body: Record<string, unknown>): TranslatorFormat {
  if ((Array.isArray(body.input) || typeof body.input === "string") && !body.messages) return "openai-responses";
  if (Array.isArray(body.contents)) return "gemini";
  if (body.system !== undefined || body.anthropic_version) return "claude";
  if (body.response_format || body.logprobs !== undefined || body.n !== undefined || body.user) return "openai";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const content = record(messages[0]).content;
  if (Array.isArray(content) && content.some((part) => ["tool_use", "tool_result"].includes(String(record(part).type)))) return "claude";
  return "openai";
}

export function splitModel(model: unknown): { provider: string; model: string } {
  const value = String(model || "");
  const slash = value.indexOf("/");
  return slash > 0 ? { provider: value.slice(0, slash), model: value.slice(slash + 1) } : { provider: "custom", model: value };
}

export function targetFormatForConnection(provider: string, connection?: ProviderConnection | null): TranslatorFormat {
  if (connection?.apiType === "anthropic" || /anthropic|claude/i.test(provider)) return "claude";
  if (connection?.apiType === "responses" || /responses|codex/i.test(provider)) return "openai-responses";
  if (/gemini|google/i.test(provider)) return "gemini";
  return "openai";
}

function messagesFromInput(input: unknown): Record<string, unknown>[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [];
  return input.map((item) => typeof item === "string" ? { role: "user", content: item } : record(item));
}

function toOpenAi(body: Record<string, unknown>, source: TranslatorFormat, model: string, stream: boolean): Record<string, unknown> {
  if (source === "openai" || source === "gemini") return { ...clone(body), model, stream };
  if (source === "openai-responses") return { ...clone(body), model, messages: messagesFromInput(body.input), stream };

  const messages: Record<string, unknown>[] = [];
  if (body.system) messages.push({ role: "system", content: typeof body.system === "string" ? body.system : JSON.stringify(body.system) });
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const item = record(message);
    const content = Array.isArray(item.content)
      ? item.content.map((part) => {
        const value = record(part);
        return value.type === "text" ? value.text : value;
      })
      : item.content;
    messages.push({ ...item, content });
  }
  return { ...clone(body), model, messages, max_tokens: body.max_tokens ?? body.max_tokens_to_sample, stream };
}

function toClaude(body: Record<string, unknown>, model: string, stream: boolean): Record<string, unknown> {
  const messages = Array.isArray(body.messages)
    ? body.messages.map((message) => {
      const item = record(message);
      return { role: item.role === "assistant" ? "assistant" : "user", content: item.content ?? "" };
    }).filter((message) => message.content !== "")
    : [];
  const system = typeof body.system === "string" ? body.system : undefined;
  return {
    model,
    max_tokens: Number(body.max_tokens || body.max_completion_tokens || 4096),
    messages,
    ...(system ? { system } : {}),
    ...(stream ? { stream: true } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.tools ? { tools: body.tools } : {}),
  };
}

function toGemini(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const contents = Array.isArray(body.messages)
    ? body.messages.map((message) => {
      const item = record(message);
      const role = item.role === "assistant" ? "model" : "user";
      const content = Array.isArray(item.content) ? item.content : [item.content ?? ""];
      return { role, parts: content.map((part) => ({ text: typeof part === "string" ? part : String(record(part).text || "") })) };
    })
    : [];
  return { model, contents, ...(body.system ? { systemInstruction: { parts: [{ text: String(body.system) }] } } : {}) };
}

export function translateToOpenAi(body: Record<string, unknown>, model: string, stream = true): Record<string, unknown> {
  return toOpenAi(body, detectTranslatorFormat(body), model, stream);
}

export function translateFromOpenAi(body: Record<string, unknown>, target: TranslatorFormat, model: string, stream = true): Record<string, unknown> {
  if (target === "claude") return toClaude(body, model, stream);
  if (target === "gemini") return toGemini(body, model);
  if (target === "openai-responses") return { ...clone(body), model, input: body.input || body.messages, stream };
  return { ...clone(body), model, stream };
}

function baseUrl(connection: ProviderConnection): string | null {
  const value = connection.baseUrl || (typeof connection.data.baseUrl === "string" ? connection.data.baseUrl : null) || (typeof connection.data.base_url === "string" ? connection.data.base_url : null);
  return value?.replace(/\/$/, "") || null;
}

export function targetUrl(connection: ProviderConnection, target: TranslatorFormat, model: string): string | null {
  const base = baseUrl(connection);
  if (!base) return null;
  if (/\/(chat\/completions|messages|responses)$/.test(base)) return base;
  if (target === "claude") return `${base}${base.endsWith("/v1") ? "/messages" : "/v1/messages"}`;
  if (target === "openai-responses") return `${base}${base.endsWith("/v1") ? "/responses" : "/v1/responses"}`;
  if (target === "gemini") return `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return `${base}${base.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions"}`;
}

export function targetHeaders(connection: ProviderConnection, target?: TranslatorFormat): Record<string, string> {
  const auth = { ...connection.data, ...connection.credentials };
  const token = auth.apiKey || auth.accessToken || auth.token;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) {
    if (connection.apiType === "anthropic" || target === "claude") headers["x-api-key"] = "[configured]";
    else headers.authorization = "Bearer [configured]";
  }
  if (connection.apiType === "anthropic" || target === "claude") headers["anthropic-version"] = "2023-06-01";
  return headers;
}
