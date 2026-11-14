import { z } from "zod";
import {
  type CatalogProviderQuirks,
  providerQuirksSchema,
} from "@/catalog/schemas/catalog.schema.js";
import type {
  AssistantContentPart,
  CacheMarker,
  FunctionTool,
  InferenceMessage,
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
  ResponseFormat,
  ToolChoice,
  UserContentPart,
} from "../../models/internal-format.js";
import { readServerSentEvents } from "../server-sent-events.js";
import {
  type UpstreamHttpRequest,
  UpstreamProtocolError,
  type UpstreamProtocolConverter,
  type UpstreamTarget,
} from "../upstream-protocol-converter.js";
import {
  type OpenAiUsage,
  openAiFinishReasonSchema,
  stopReasonOf,
  tokenUsageOf,
  usageSchema,
} from "./openai-chat-usage.js";

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const STREAM_END = "[DONE]";
// Some Providers reject an empty `reasoning_content` on a turn that must carry one.
const REASONING_PLACEHOLDER = " ";

// Key order here is the order on the wire: keep it fixed so the same request
// always gives the same bytes (upstream prompt caches compare prefixes).

function writeRequest(request: InferenceRequest, target: UpstreamTarget): UpstreamHttpRequest {
  const quirks = providerQuirksSchema.parse(target.quirks);
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
  if (request.reasoning?.effort) {
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
      }),
    )
    .min(1),
  usage: usageSchema.nullish(),
});

function parseResponse(body: unknown): InferenceResponse {
  const parsed = completionSchema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamProtocolError(`Not a chat completion: ${parsed.error.message}`);
  }
  const [{ message, finish_reason }] = parsed.data.choices;
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
    usage: tokenUsageOf(parsed.data.usage ?? undefined),
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
    }),
  ),
  usage: usageSchema.nullish(),
});

const streamErrorSchema = z.object({ error: z.unknown() });

async function* parseStream(body: AsyncIterable<Uint8Array>): AsyncIterable<InferenceStreamEvent> {
  for await (const { data } of readServerSentEvents(body)) {
    if (data === STREAM_END) {
      return;
    }
    yield* eventsOfChunk(parseJson(data));
  }
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new UpstreamProtocolError("A stream chunk is not JSON", { cause: error });
  }
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
  if (chunk.data.usage) {
    yield { type: "usage", usage: tokenUsageOf(chunk.data.usage satisfies OpenAiUsage) };
  }
}

/** The `openai-chat` upstream Protocol: OpenAI Chat Completions and the Providers that copy it. */
export const openAiChatUpstreamConverter: UpstreamProtocolConverter = {
  protocol: "openai-chat",
  writeRequest,
  parseResponse,
  parseStream,
};
