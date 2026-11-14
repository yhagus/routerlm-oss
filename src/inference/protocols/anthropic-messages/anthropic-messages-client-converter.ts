import { z } from "zod";
import type { GatewayErrorCode } from "../../../db/schemas/index.js";
import { GatewayError } from "../../gateway-error.js";
import {
  type AssistantContentPart,
  type CacheMarker,
  type InferenceMessage,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceStreamEvent,
  type ReasoningEffort,
  type StopReason,
  type TextPart,
  type TokenUsage,
  type ToolChoice,
  UNREPORTED_USAGE,
  type UserContentPart,
} from "../../internal-format.js";
import type { ClientProtocolConverter, ResponseContext } from "../client-protocol-converter.js";

// The Anthropic Messages client Protocol (`POST /v1/messages`).
// Schemas are plain (non-strict) zod objects: unknown fields are dropped (ADR 0002).

const cacheControlSchema = z.object({
  type: z.literal("ephemeral"),
  ttl: z.enum(["5m", "1h"]).optional(),
});
type CacheControl = z.infer<typeof cacheControlSchema>;

const textBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  cache_control: cacheControlSchema.nullish(),
});
const imageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("base64"), media_type: z.string().min(1), data: z.string() }),
    z.object({ type: z.literal("url"), url: z.string().min(1) }),
  ]),
  cache_control: cacheControlSchema.nullish(),
});
const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(z.union([textBlockSchema, imageBlockSchema]))]).optional(),
  cache_control: cacheControlSchema.nullish(),
});
const userBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  imageBlockSchema,
  toolResultBlockSchema,
]);

const assistantBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
  // Opaque to every other Protocol, so the internal format can't hold it.
  z.object({ type: z.literal("redacted_thinking") }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
]);

const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.union([z.string(), z.array(userBlockSchema)]) }),
  z.object({
    role: z.literal("assistant"),
    content: z.union([z.string(), z.array(assistantBlockSchema)]),
  }),
]);
type ClientMessage = z.infer<typeof messageSchema>;

const CLIENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type ClientEffort = (typeof CLIENT_EFFORTS)[number];
/** "max" has no internal counterpart above "xhigh". */
const CLIENT_EFFORT_LEVELS: Record<ClientEffort, ReasoningEffort> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

const requestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.int().positive(),
  system: z.union([z.string(), z.array(textBlockSchema)]).optional(),
  messages: z.array(messageSchema).min(1),
  tools: z
    .array(
      z.object({
        type: z.literal("custom").optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        input_schema: z.record(z.string(), z.unknown()),
        strict: z.boolean().nullish(),
        cache_control: cacheControlSchema.nullish(),
      }),
    )
    .optional(),
  tool_choice: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("auto"), disable_parallel_tool_use: z.boolean().optional() }),
      z.object({ type: z.literal("any"), disable_parallel_tool_use: z.boolean().optional() }),
      z.object({
        type: z.literal("tool"),
        name: z.string().min(1),
        disable_parallel_tool_use: z.boolean().optional(),
      }),
      z.object({ type: z.literal("none") }),
    ])
    .optional(),
  thinking: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("enabled"), budget_tokens: z.int().positive() }),
      z.object({ type: z.literal("adaptive") }),
      z.object({ type: z.literal("disabled") }),
    ])
    .optional(),
  output_config: z
    .object({
      effort: z.enum(CLIENT_EFFORTS).optional(),
      format: z
        .object({ type: z.literal("json_schema"), schema: z.record(z.string(), z.unknown()) })
        .nullish(),
    })
    .optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  cache_control: cacheControlSchema.nullish(),
});
type ClientRequest = z.infer<typeof requestSchema>;

const MESSAGE_ID_PREFIX = "msg_";
/** The Protocol's JSON schema output has no name; other Protocols need one. */
const RESPONSE_FORMAT_NAME = "response";
/** What the Protocol's adaptive thinking does when the client sets no effort. */
const DEFAULT_ADAPTIVE_EFFORT: ReasoningEffort = "high";

function parseRequest(body: unknown): InferenceRequest {
  refuseOutOfScopeFeatures(body);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError("invalid_request", `Invalid request: ${z.prettifyError(parsed.error)}`);
  }
  return toInferenceRequest(parsed.data);
}

const typedBlocksSchema = z.array(z.object({ type: z.unknown() }).loose());
const featureRefusedSchema = z.object({
  mcp_servers: z.unknown().optional(),
  tools: z.array(z.object({ type: z.unknown() })).optional(),
  messages: z.array(z.object({ role: z.unknown(), content: z.unknown() })).optional(),
});

const SUPPORTED_BLOCKS = new Set([
  "text",
  "image",
  "tool_result",
  "thinking",
  "redacted_thinking",
  "tool_use",
]);
const SUPPORTED_IMAGE_SOURCES = new Set(["base64", "url"]);

/** Features ADR 0002 keeps out of v1 get a 400 that names them, rather than being dropped. */
function refuseOutOfScopeFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return; // Malformed: the full schema explains it.
  }
  const { mcp_servers, tools, messages } = features.data;
  if (mcp_servers !== undefined) {
    throw unsupported("MCP servers (`mcp_servers`)");
  }
  const serverTool = tools?.find((tool) => tool.type !== undefined && tool.type !== "custom");
  if (serverTool) {
    throw unsupported(
      `tools of type \`${String(serverTool.type)}\`; only custom tools are supported`,
    );
  }
  for (const message of messages ?? []) {
    if (message.role === "system") {
      throw unsupported("messages with role `system`; use the top-level `system`");
    }
    refuseUnsupportedBlocks(message.content);
  }
}

function refuseUnsupportedBlocks(content: unknown): void {
  const blocks = typedBlocksSchema.safeParse(content);
  if (!blocks.success) {
    return; // A string, or malformed: the full schema explains it.
  }
  for (const block of blocks.data) {
    if (typeof block.type === "string" && !SUPPORTED_BLOCKS.has(block.type)) {
      throw unsupported(`content blocks of type \`${block.type}\``);
    }
    const source = z.object({ source: z.object({ type: z.unknown() }) }).safeParse(block);
    if (source.success && !SUPPORTED_IMAGE_SOURCES.has(String(source.data.source.type))) {
      throw unsupported(`content sources of type \`${String(source.data.source.type)}\``);
    }
    refuseUnsupportedBlocks(block.content);
  }
}

function unsupported(feature: string): GatewayError {
  return new GatewayError("invalid_request", `Not supported: ${feature}`);
}

function toInferenceRequest(request: ClientRequest): InferenceRequest {
  const messages = request.messages.flatMap(toInferenceMessages);
  if (request.cache_control) {
    markLastBlock(messages, cacheMarkerOf(request.cache_control));
  }
  const parsed: InferenceRequest = {
    model: request.model,
    system: request.system === undefined ? [] : textParts(request.system),
    messages,
    tools: (request.tools ?? []).map((tool) => ({
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      parameters: tool.input_schema,
      ...(tool.strict != null && { strict: tool.strict }),
      ...(tool.cache_control && { cacheMarker: cacheMarkerOf(tool.cache_control) }),
    })),
    maxOutputTokens: request.max_tokens,
    // The Protocol always reports usage in a stream.
    stream: request.stream ? { includeUsage: true } : null,
  };
  if (request.tool_choice !== undefined) {
    parsed.toolChoice = toToolChoice(request.tool_choice);
    if (request.tool_choice.type !== "none" && request.tool_choice.disable_parallel_tool_use) {
      parsed.parallelToolCalls = false;
    }
  }
  if (request.output_config?.format) {
    parsed.responseFormat = {
      type: "json-schema",
      name: RESPONSE_FORMAT_NAME,
      schema: request.output_config.format.schema,
    };
  }
  const reasoning = toReasoning(request);
  if (reasoning !== undefined) {
    parsed.reasoning = reasoning;
  }
  if (request.temperature !== undefined) {
    parsed.temperature = request.temperature;
  }
  if (request.top_p !== undefined) {
    parsed.topP = request.top_p;
  }
  if (request.stop_sequences !== undefined) {
    parsed.stopSequences = request.stop_sequences;
  }
  return parsed;
}

function cacheMarkerOf(cacheControl: CacheControl): CacheMarker {
  return cacheControl.ttl === undefined ? {} : { ttl: cacheControl.ttl };
}

function textParts(content: string | z.infer<typeof textBlockSchema>[]): TextPart[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map(toTextPart);
}

function toTextPart(block: z.infer<typeof textBlockSchema>): TextPart {
  return {
    type: "text",
    text: block.text,
    ...(block.cache_control && { cacheMarker: cacheMarkerOf(block.cache_control) }),
  };
}

function toUserContentPart(
  block: z.infer<typeof textBlockSchema> | z.infer<typeof imageBlockSchema>,
): UserContentPart {
  if (block.type === "text") {
    return toTextPart(block);
  }
  const source =
    block.source.type === "url"
      ? { type: "url" as const, url: block.source.url }
      : { type: "base64" as const, mediaType: block.source.media_type, data: block.source.data };
  return {
    type: "image",
    source,
    ...(block.cache_control && { cacheMarker: cacheMarkerOf(block.cache_control) }),
  };
}

/**
 * A user turn can carry tool results and text together; the internal format
 * has one tool message per result, so the turn splits in its original order.
 */
function toInferenceMessages(message: ClientMessage): InferenceMessage[] {
  if (typeof message.content === "string") {
    const content = [{ type: "text" as const, text: message.content }];
    return [message.role === "user" ? { role: "user", content } : { role: "assistant", content }];
  }
  if (message.role === "assistant") {
    return [{ role: "assistant", content: message.content.flatMap(toAssistantContentPart) }];
  }
  const messages: InferenceMessage[] = [];
  let userContent: UserContentPart[] = [];
  for (const block of message.content) {
    if (block.type !== "tool_result") {
      userContent.push(toUserContentPart(block));
      continue;
    }
    if (userContent.length > 0) {
      messages.push({ role: "user", content: userContent });
      userContent = [];
    }
    messages.push({
      role: "tool",
      toolCallId: block.tool_use_id,
      content: toolResultContent(block),
    });
  }
  if (userContent.length > 0) {
    messages.push({ role: "user", content: userContent });
  }
  return messages;
}

/** A marker on the tool result itself moves to its last part, which ends the same prefix. */
function toolResultContent(block: z.infer<typeof toolResultBlockSchema>): UserContentPart[] {
  const content =
    typeof block.content === "string"
      ? [{ type: "text" as const, text: block.content }]
      : (block.content ?? []).map(toUserContentPart);
  const last = content.at(-1);
  if (block.cache_control && last) {
    last.cacheMarker = cacheMarkerOf(block.cache_control);
  }
  return content;
}

function toAssistantContentPart(
  block: z.infer<typeof assistantBlockSchema>,
): AssistantContentPart[] {
  switch (block.type) {
    case "text":
      return [toTextPart(block)];
    case "thinking":
      // An empty signature is what this gateway writes for reasoning from a
      // Protocol without signatures; it proves nothing, so it isn't kept.
      return [
        {
          type: "reasoning",
          text: block.thinking,
          ...(block.signature !== "" && { signature: block.signature }),
        },
      ];
    case "redacted_thinking":
      return [];
    case "tool_use":
      return [
        {
          type: "tool-call",
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      ];
  }
}

/** Top-level `cache_control` asks for a breakpoint on the last block of the conversation. */
function markLastBlock(messages: InferenceMessage[], marker: CacheMarker): void {
  const last = messages.at(-1);
  if (last?.role === "assistant") {
    return; // Assistant content parts carry no markers in the internal format.
  }
  const lastPart = last?.content.at(-1);
  if (lastPart && lastPart.cacheMarker === undefined) {
    lastPart.cacheMarker = marker;
  }
}

function toToolChoice(choice: NonNullable<ClientRequest["tool_choice"]>): ToolChoice {
  switch (choice.type) {
    case "auto":
      return { type: "auto" };
    case "any":
      return { type: "required" };
    case "none":
      return { type: "none" };
    case "tool":
      return { type: "tool", name: choice.name };
  }
}

/**
 * A fixed budget wins over an effort level. Adaptive thinking (or no thinking
 * setting) follows `output_config.effort`; adaptive thinking without one runs
 * at the Protocol's default effort.
 */
function toReasoning(request: ClientRequest): InferenceRequest["reasoning"] {
  const effort = request.output_config?.effort;
  switch (request.thinking?.type) {
    case "enabled":
      return { budgetTokens: request.thinking.budget_tokens };
    case "disabled":
      return { effort: "none" };
    case "adaptive":
      return {
        effort: effort === undefined ? DEFAULT_ADAPTIVE_EFFORT : CLIENT_EFFORT_LEVELS[effort],
      };
    case undefined:
      return effort === undefined ? undefined : { effort: CLIENT_EFFORT_LEVELS[effort] };
  }
}

const STOP_REASONS = {
  end: "end_turn",
  "max-tokens": "max_tokens",
  "tool-calls": "tool_use",
  "stop-sequence": "stop_sequence",
  "content-filter": "refusal",
} as const satisfies Record<StopReason, string>;

function writeResponse(
  response: InferenceResponse,
  _request: InferenceRequest,
  context: ResponseContext,
): unknown {
  return {
    ...messageHeader(context),
    content: response.content.map(writeContentBlock),
    // The internal format doesn't say which stop sequence matched.
    stop_reason: STOP_REASONS[response.stopReason],
    stop_sequence: null,
    usage: writeUsage(response.usage),
  };
}

function messageHeader(context: ResponseContext): Record<string, unknown> {
  return {
    id: `${MESSAGE_ID_PREFIX}${context.requestId}`,
    type: "message",
    role: "assistant",
    model: context.modelName,
  };
}

function writeContentBlock(part: AssistantContentPart): Record<string, unknown> {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "reasoning":
      // Reasoning from a Protocol without signatures gets an empty one, which
      // parseRequest drops again when the client sends it back.
      return { type: "thinking", thinking: part.text, signature: part.signature ?? "" };
    case "tool-call":
      return { type: "tool_use", id: part.id, name: part.name, input: toolInputOf(part.arguments) };
  }
}

/** The Protocol carries tool input as an object; arguments the model left malformed become `{}`. */
function toolInputOf(toolArguments: string): unknown {
  try {
    const input: unknown = JSON.parse(toolArguments);
    return typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
  } catch {
    return {};
  }
}

/** The Protocol's counts are required numbers, except the cache counts. */
function writeUsage(usage: TokenUsage): Record<string, unknown> {
  return {
    input_tokens: usage.inputTokens ?? 0,
    cache_creation_input_tokens: usage.cacheWriteTokens,
    cache_read_input_tokens: usage.cacheReadTokens,
    output_tokens: usage.outputTokens ?? 0,
  };
}

/**
 * Stream events are written as the Protocol's named events. The stop reason
 * and usage arrive in any order, so both are held until the stream ends and
 * go out together in `message_delta`.
 */
async function* writeStream(
  events: AsyncIterable<InferenceStreamEvent>,
  _request: InferenceRequest,
  context: ResponseContext,
): AsyncIterable<string> {
  yield namedEvent("message_start", {
    type: "message_start",
    message: {
      ...messageHeader(context),
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: writeUsage(UNREPORTED_USAGE),
    },
  });
  const blocks = new ContentBlockWriter();
  let stopReason: StopReason = "end";
  let usage = UNREPORTED_USAGE;
  for await (const event of events) {
    if (event.type === "finish") {
      stopReason = event.stopReason;
    } else if (event.type === "usage") {
      usage = event.usage;
    } else {
      yield* blocks.write(event);
    }
  }
  yield* blocks.closeOpenBlock();
  yield namedEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: STOP_REASONS[stopReason], stop_sequence: null },
    usage: writeUsage(usage),
  });
  yield namedEvent("message_stop", { type: "message_stop" });
}

/** The event that ends a stream which failed after its first chunk reached the client. */
function writeStreamError(error: GatewayError): string {
  return namedEvent("error", writeError(error));
}

type ContentEvent = Exclude<InferenceStreamEvent, { type: "finish" | "usage" }>;
type OpenBlock =
  | { type: "text" }
  | { type: "thinking"; isSigned: boolean }
  | { type: "tool_use"; toolIndex: number };

/**
 * Turns internal deltas into the Protocol's content blocks: each block is
 * started, filled with deltas, and stopped before the next one starts.
 */
class ContentBlockWriter {
  private index = -1;
  private open: OpenBlock | null = null;

  *write(event: ContentEvent): Iterable<string> {
    switch (event.type) {
      case "text-delta":
        if (this.open?.type !== "text") {
          yield* this.start({ type: "text" }, { type: "text", text: "" });
        }
        yield this.delta({ type: "text_delta", text: event.text });
        return;
      case "reasoning-delta":
        yield* this.startThinkingUnlessOpen();
        yield this.delta({ type: "thinking_delta", thinking: event.text });
        return;
      case "reasoning-signature":
        yield* this.startThinkingUnlessOpen();
        yield this.delta({ type: "signature_delta", signature: event.signature });
        this.open = { type: "thinking", isSigned: true };
        return;
      case "tool-call-start":
        yield* this.start(
          { type: "tool_use", toolIndex: event.index },
          { type: "tool_use", id: event.id, name: event.name, input: {} },
        );
        return;
      case "tool-call-delta":
        if (this.open?.type !== "tool_use" || this.open.toolIndex !== event.index) {
          // A stopped block can't be reopened. Upstreams finish one call's
          // arguments before starting the next, so this means a broken stream.
          throw new GatewayError("upstream_error", "The upstream interleaved tool call arguments");
        }
        yield this.delta({ type: "input_json_delta", partial_json: event.argumentsDelta });
        return;
    }
  }

  *closeOpenBlock(): Iterable<string> {
    if (this.open !== null) {
      yield namedEvent("content_block_stop", { type: "content_block_stop", index: this.index });
      this.open = null;
    }
  }

  /** A signature ends a thinking block, so reasoning after it starts a new one. */
  private *startThinkingUnlessOpen(): Iterable<string> {
    if (this.open?.type !== "thinking" || this.open.isSigned) {
      yield* this.start(
        { type: "thinking", isSigned: false },
        { type: "thinking", thinking: "", signature: "" },
      );
    }
  }

  private *start(block: OpenBlock, contentBlock: Record<string, unknown>): Iterable<string> {
    yield* this.closeOpenBlock();
    this.index += 1;
    this.open = block;
    yield namedEvent("content_block_start", {
      type: "content_block_start",
      index: this.index,
      content_block: contentBlock,
    });
  }

  private delta(delta: Record<string, unknown>): string {
    return namedEvent("content_block_delta", {
      type: "content_block_delta",
      index: this.index,
      delta,
    });
  }
}

function namedEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The Protocol's error types; the gateway's own code travels next to them. */
const ERROR_TYPES = {
  invalid_request: "invalid_request_error",
  no_capable_route: "invalid_request_error",
  invalid_api_key: "authentication_error",
  model_not_allowed: "permission_error",
  model_not_found: "not_found_error",
  request_too_large: "request_too_large",
  upstream_rate_limited: "rate_limit_error",
  upstream_error: "api_error",
  upstream_timeout: "api_error",
} as const satisfies Record<GatewayErrorCode, string>;

function writeError(error: GatewayError): unknown {
  return {
    type: "error",
    error: { type: ERROR_TYPES[error.code], message: error.message, code: error.code },
  };
}

export const anthropicMessagesClientConverter: ClientProtocolConverter = {
  protocol: "anthropic-messages",
  parseRequest,
  writeResponse,
  writeStream,
  writeError,
  writeStreamError,
};
