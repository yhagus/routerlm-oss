import { z } from "zod";
import type { CatalogProviderQuirks } from "@/catalog/schemas/catalog.schema.js";
import type {
  AssistantContentPart,
  CacheMarker,
  FunctionTool,
  InferenceMessage,
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
  ReasoningEffort,
  ResponseFormat,
  ToolChoice,
  UserContentPart,
} from "@/inference/models/internal-format.js";
import { isJsonObject } from "@/inference/protocols/json-object.js";
import type { ServerSentEvent } from "@/inference/protocols/server-sent-events.js";
import {
  type UpstreamHttpRequest,
  UpstreamProtocolError,
  type UpstreamProtocolConverter,
  type UpstreamStreamParser,
  type UpstreamTarget,
} from "@/inference/protocols/upstream-protocol-converter.js";
import {
  type OpenAiUsage,
  openAiFinishReasonSchema,
  stopReasonOf,
  tokenUsageOf,
  usageSchema,
} from "./openai-chat-usage.js";

type ReasoningAsThinking = NonNullable<CatalogProviderQuirks["reasoningAsThinking"]>;

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const STREAM_END = "[DONE]";
// Some Providers reject an empty `reasoning_content` on a turn that must carry one.
const REASONING_PLACEHOLDER = " ";

// Key order here is the order on the wire: keep it fixed so the same request
// always gives the same bytes (upstream prompt caches compare prefixes).

function writeRequest(request: InferenceRequest, target: UpstreamTarget): UpstreamHttpRequest {
  const { quirks } = target;
  const body: Record<string, unknown> = {
    model: target.upstreamModelId,
    messages: [
      ...request.system.map((part) => ({
        role: "system",
        content: keepsCacheMarkers(quirks, [part]) ? [writeTextPart(part, quirks)] : part.text,
      })),
      ...request.messages.map((message) => writeMessage(message, quirks)),
    ],
  };
  if (request.tools.length > 0) {
    body.tools = request.tools.map(writeTool);
  }
  if (request.toolChoice) {
    body.tool_choice = writeToolChoice(request.toolChoice);
  }
  if (request.parallelToolCalls !== undefined) {
    body.parallel_tool_calls = request.parallelToolCalls;
  }
  if (request.responseFormat) {
    body.response_format = writeResponseFormat(request.responseFormat);
  }
  // Chat Completions has no thinking budget; only an effort level survives.
  if (quirks.reasoningAsThinking) {
    body.thinking = writeThinking(request.reasoning?.effort, target, quirks.reasoningAsThinking);
  } else if (request.reasoning?.effort) {
    body.reasoning_effort = request.reasoning.effort;
  }
  if (request.maxOutputTokens !== undefined) {
    body[quirks.usesMaxCompletionTokens ? "max_completion_tokens" : "max_tokens"] =
      request.maxOutputTokens;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.topP !== undefined) {
    body.top_p = request.topP;
  }
  if (request.stopSequences) {
    body.stop = request.stopSequences;
  }
  if (quirks.acceptsPromptCacheKey && target.promptCacheKey !== undefined) {
    body.prompt_cache_key = target.promptCacheKey;
  } else if (quirks.forwardsClientPromptCacheKey && request.promptCacheKey !== undefined) {
    body.prompt_cache_key = request.promptCacheKey;
  }
  if (target.serviceTierValue !== undefined) {
    body.service_tier = target.serviceTierValue;
  }
  if (request.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return {
    url: `${target.baseUrl.replace(/\/+$/, "")}${CHAT_COMPLETIONS_PATH}`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Reasoning for a Provider that takes a `thinking` object. Thinking stays
 * enabled whatever the client asked: the Provider's models cannot turn it
 * off. Without an effort the Provider's own default for the model applies.
 */
function writeThinking(
  effort: ReasoningEffort | undefined,
  target: UpstreamTarget,
  { efforts, upstreamModelsWithoutEffort = [] }: ReasoningAsThinking,
): Record<string, unknown> {
  if (effort === undefined || upstreamModelsWithoutEffort.includes(target.upstreamModelId)) {
    return { type: "enabled" };
  }
  return { type: "enabled", effort: efforts[effort] };
}

function writeMessage(
  message: InferenceMessage,
  quirks: CatalogProviderQuirks,
): Record<string, unknown> {
  switch (message.role) {
    case "user":
      return { role: "user", content: writeUserContent(message.content, quirks) };
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: writeUserContent(message.content, quirks),
      };
    case "assistant":
      return writeAssistantMessage(message.content, quirks);
  }
}

/**
 * A lone text part goes as a plain string, which every openai-chat Provider
 * accepts, unless it carries a cache marker the Provider keeps: a marker
 * needs a content part to sit on.
 */
function writeUserContent(
  content: UserContentPart[],
  quirks: CatalogProviderQuirks,
): string | Record<string, unknown>[] {
  const [first] = content;
  if (content.length === 1 && first.type === "text" && !keepsCacheMarkers(quirks, content)) {
    return first.text;
  }
  return content.map((part) =>
    part.type === "text"
      ? writeTextPart(part, quirks)
      : withCacheControl(
          { type: "image_url", image_url: { url: imageUrlOf(part.source) } },
          part.cacheMarker,
          quirks,
        ),
  );
}

/** Whether the Provider keeps client cache markers and one of these parts carries one. */
function keepsCacheMarkers(
  quirks: CatalogProviderQuirks,
  parts: { cacheMarker?: CacheMarker }[],
): boolean {
  return quirks.acceptsCacheControl === true && parts.some((part) => part.cacheMarker);
}

function writeTextPart(
  part: { text: string; cacheMarker?: CacheMarker },
  quirks: CatalogProviderQuirks,
): Record<string, unknown> {
  return withCacheControl({ type: "text", text: part.text }, part.cacheMarker, quirks);
}

/**
 * Writes the client's cache marker as `cache_control` when the Provider keeps
 * markers (spec "Cache behavior"); otherwise it is dropped. Alibaba Model
 * Studio documents only the `ephemeral` type with a fixed lifetime, so a
 * client's TTL is not sent.
 */
function withCacheControl(
  part: Record<string, unknown>,
  marker: CacheMarker | undefined,
  quirks: CatalogProviderQuirks,
): Record<string, unknown> {
  if (!marker || !quirks.acceptsCacheControl) {
    return part;
  }
  return { ...part, cache_control: { type: "ephemeral" } };
}

function imageUrlOf(source: Extract<UserContentPart, { type: "image" }>["source"]): string {
  return source.type === "url" ? source.url : `data:${source.mediaType};base64,${source.data}`;
}

function writeAssistantMessage(
  content: AssistantContentPart[],
  quirks: CatalogProviderQuirks,
): Record<string, unknown> {
  const reasoning = content
    .flatMap((part) => (part.type === "reasoning" ? [part.text] : []))
    .join("");
  const toolCalls = content.flatMap((part) => (part.type === "tool-call" ? [part] : []));

  const message: Record<string, unknown> = {
    role: "assistant",
    content: writeAssistantText(content, quirks),
  };
  if (mustCarryReasoning(quirks, toolCalls.length > 0)) {
    message.reasoning_content = reasoning === "" ? REASONING_PLACEHOLDER : reasoning;
  }
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return message;
}

/** Text parts are joined into one string, unless a cache marker the Provider keeps needs them as parts. */
function writeAssistantText(
  content: AssistantContentPart[],
  quirks: CatalogProviderQuirks,
): string | Record<string, unknown>[] | null {
  const textParts = content.flatMap((part) => (part.type === "text" ? [part] : []));
  if (keepsCacheMarkers(quirks, textParts)) {
    return textParts.map((part) => writeTextPart(part, quirks));
  }
  const text = textParts.map((part) => part.text).join("");
  return text === "" ? null : text;
}

function mustCarryReasoning(quirks: CatalogProviderQuirks, hasToolCalls: boolean): boolean {
  switch (quirks.reasoningContentInHistory) {
    case "all-assistant-turns":
      return true;
    case "tool-call-turns":
      return hasToolCalls;
    case undefined:
      return false;
  }
}

function writeTool(tool: FunctionTool): Record<string, unknown> {
  const definition: Record<string, unknown> = { name: tool.name };
  if (tool.description !== undefined) {
    definition.description = tool.description;
  }
  definition.parameters = tool.parameters;
  if (tool.strict !== undefined) {
    definition.strict = tool.strict;
  }
  return { type: "function", function: definition };
}

function writeToolChoice(choice: ToolChoice): unknown {
  return choice.type === "tool"
    ? { type: "function", function: { name: choice.name } }
    : choice.type;
}

function writeResponseFormat(format: ResponseFormat): Record<string, unknown> {
  switch (format.type) {
    case "text":
      return { type: "text" };
    case "json-object":
      return { type: "json_object" };
    case "json-schema": {
      const jsonSchema: Record<string, unknown> = { name: format.name, schema: format.schema };
      if (format.strict !== undefined) {
        jsonSchema.strict = format.strict;
      }
      return { type: "json_schema", json_schema: jsonSchema };
    }
  }
}

// Responses are read leniently: only the fields the internal format needs.

const toolCallSchema = z.object({
  id: z.string(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
          tool_calls: z.array(toolCallSchema).nullish(),
        }),
        finish_reason: openAiFinishReasonSchema,
        // Kimi Code may report usage here instead of at the top level.
        usage: usageSchema.nullish(),
      }),
    )
    .min(1),
  usage: usageSchema.nullish(),
  service_tier: z.string().nullish(),
});

function parseResponse(body: unknown): InferenceResponse {
  const parsed = completionSchema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamProtocolError(`Not a chat completion: ${parsed.error.message}`);
  }
  const [{ message, finish_reason, usage: usageInChoice }] = parsed.data.choices;
  const content: AssistantContentPart[] = [];
  if (message.reasoning_content) {
    content.push({ type: "reasoning", text: message.reasoning_content });
  }
  if (message.content) {
    content.push({ type: "text", text: message.content });
  }
  for (const call of message.tool_calls ?? []) {
    content.push({
      type: "tool-call",
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    });
  }
  return {
    content,
    stopReason: stopReasonOf(finish_reason),
    usage: tokenUsageOf(parsed.data.usage ?? usageInChoice ?? undefined),
    ...(parsed.data.service_tier && { servedTierValue: parsed.data.service_tier }),
  };
}

const chunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z
        .object({
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                index: z.number(),
                id: z.string().nullish(),
                function: z
                  .object({ name: z.string().nullish(), arguments: z.string().nullish() })
                  .nullish(),
              }),
            )
            .nullish(),
        })
        .nullish(),
      finish_reason: openAiFinishReasonSchema.nullish(),
      usage: usageSchema.nullish(),
    }),
  ),
  usage: usageSchema.nullish(),
  service_tier: z.string().nullish(),
});

const streamErrorSchema = z.object({ error: z.unknown() });

/** A body that ends without `[DONE]` ends normally: not every Provider sends it. */
class ChatStreamParser implements UpstreamStreamParser {
  isDone = false;

  parse({ data }: ServerSentEvent): InferenceStreamEvent[] {
    if (data === STREAM_END) {
      this.isDone = true;
      return [];
    }
    const json = parseJson(data);
    return eventsOfTokenChunk(json) ?? [...eventsOfChunk(json)];
  }

  end(): InferenceStreamEvent[] {
    return [];
  }
}

function startStream(): UpstreamStreamParser {
  return new ChatStreamParser();
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new UpstreamProtocolError("A stream chunk is not JSON", { cause: error });
  }
}

/**
 * The events of a chunk that only carries text or reasoning (most of a
 * stream), read without running two zod schemas on every token. Undefined for
 * any other chunk, which takes the schema path: this accepts only chunks that
 * streamErrorSchema rejects and chunkSchema accepts, and gives the events
 * eventsOfChunk would.
 */
function eventsOfTokenChunk(json: unknown): InferenceStreamEvent[] | undefined {
  // streamErrorSchema matches any object with an `error` key, whatever its value.
  if (!isJsonObject(json) || "error" in json || !Array.isArray(json.choices)) {
    return undefined;
  }
  if (!isNullish(json.usage) || !isNullishString(json.service_tier)) {
    return undefined;
  }
  const events: InferenceStreamEvent[] = [];
  for (const choice of json.choices) {
    if (!isJsonObject(choice) || !isNullish(choice.finish_reason) || !isNullish(choice.usage)) {
      return undefined;
    }
    const delta = choice.delta;
    if (isNullish(delta)) {
      continue;
    }
    if (
      !isJsonObject(delta) ||
      !isNullish(delta.tool_calls) ||
      !isNullishString(delta.content) ||
      !isNullishString(delta.reasoning_content)
    ) {
      return undefined;
    }
    if (delta.reasoning_content) {
      events.push({ type: "reasoning-delta", text: delta.reasoning_content });
    }
    if (delta.content) {
      events.push({ type: "text-delta", text: delta.content });
    }
  }
  return events;
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function isNullishString(value: unknown): value is string | null | undefined {
  return typeof value === "string" || isNullish(value);
}

function* eventsOfChunk(json: unknown): Iterable<InferenceStreamEvent> {
  if (streamErrorSchema.safeParse(json).success) {
    throw new UpstreamProtocolError(
      `The upstream reported an error mid-stream: ${JSON.stringify(json)}`,
    );
  }
  const chunk = chunkSchema.safeParse(json);
  if (!chunk.success) {
    throw new UpstreamProtocolError(`Not a chat completion chunk: ${chunk.error.message}`);
  }
  for (const choice of chunk.data.choices) {
    const delta = choice.delta;
    if (delta?.reasoning_content) {
      yield { type: "reasoning-delta", text: delta.reasoning_content };
    }
    if (delta?.content) {
      yield { type: "text-delta", text: delta.content };
    }
    for (const call of delta?.tool_calls ?? []) {
      if (call.id && call.function?.name) {
        yield { type: "tool-call-start", index: call.index, id: call.id, name: call.function.name };
      }
      if (call.function?.arguments) {
        yield {
          type: "tool-call-delta",
          index: call.index,
          argumentsDelta: call.function.arguments,
        };
      }
    }
    if (choice.finish_reason) {
      yield { type: "finish", stopReason: stopReasonOf(choice.finish_reason) };
    }
  }
  const usage: OpenAiUsage | null | undefined = chunk.data.usage ?? chunk.data.choices[0]?.usage;
  if (usage) {
    yield {
      type: "usage",
      usage: tokenUsageOf(usage),
      ...(chunk.data.service_tier && { servedTierValue: chunk.data.service_tier }),
    };
  }
}

/** The `openai-chat` upstream Protocol: OpenAI Chat Completions and the Providers that copy it. */
export const openAiChatUpstreamConverter: UpstreamProtocolConverter = {
  protocol: "openai-chat",
  writeRequest,
  parseResponse,
  startStream,
};
