import { z } from "zod";
import { GatewayError } from "../../gateway-error.js";
import {
  type AssistantContentPart,
  type InferenceMessage,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceStreamEvent,
  REASONING_EFFORTS,
  type ResponseFormat,
  type TextPart,
  type TokenUsage,
  type ToolChoice,
  type UserContentPart,
} from "../../internal-format.js";
import type { ClientProtocolConverter, ResponseContext } from "../client-protocol-converter.js";
import { finishReasonOf, writeUsage } from "./openai-chat-usage.js";

// The Chat Completions client Protocol (`POST /v1/chat/completions`).
// Schemas are plain (non-strict) zod objects: unknown fields are dropped (ADR 0002).

const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });
const imagePartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({ url: z.string().min(1) }),
});
const textContentSchema = z.union([z.string(), z.array(textPartSchema)]);

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function").optional(),
  function: z.object({ name: z.string().min(1), arguments: z.string() }),
});

const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: textContentSchema }),
  z.object({ role: z.literal("developer"), content: textContentSchema }),
  z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(z.union([textPartSchema, imagePartSchema]))]),
  }),
  z.object({
    role: z.literal("assistant"),
    content: textContentSchema.nullish(),
    reasoning_content: z.string().nullish(),
    tool_calls: z.array(toolCallSchema).nullish(),
  }),
  z.object({
    role: z.literal("tool"),
    tool_call_id: z.string().min(1),
    content: textContentSchema,
  }),
]);
type ClientMessage = z.infer<typeof messageSchema>;

const requestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  tools: z
    .array(
      z.object({
        type: z.literal("function"),
        function: z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          parameters: z.record(z.string(), z.unknown()).optional(),
          strict: z.boolean().nullish(),
        }),
      }),
    )
    .optional(),
  tool_choice: z
    .union([
      z.enum(["auto", "none", "required"]),
      z.object({ type: z.literal("function"), function: z.object({ name: z.string().min(1) }) }),
    ])
    .optional(),
  parallel_tool_calls: z.boolean().optional(),
  response_format: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("text") }),
      z.object({ type: z.literal("json_object") }),
      z.object({
        type: z.literal("json_schema"),
        json_schema: z.object({
          name: z.string().min(1),
          schema: z.record(z.string(), z.unknown()).optional(),
          strict: z.boolean().nullish(),
        }),
      }),
    ])
    .optional(),
  reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
  max_completion_tokens: z.int().positive().nullish(),
  max_tokens: z.int().positive().nullish(),
  temperature: z.number().min(0).max(2).nullish(),
  top_p: z.number().min(0).max(1).nullish(),
  stop: z.union([z.string(), z.array(z.string())]).nullish(),
  stream: z.boolean().nullish(),
  stream_options: z.object({ include_usage: z.boolean().optional() }).nullish(),
});
type ClientRequest = z.infer<typeof requestSchema>;

const COMPLETION_ID_PREFIX = "chatcmpl-";
const EMPTY_PARAMETERS_SCHEMA = { type: "object", properties: {} };
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

function parseRequest(body: unknown): InferenceRequest {
  refuseOutOfScopeFeatures(body);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError("invalid_request", `Invalid request: ${z.prettifyError(parsed.error)}`);
  }
  return toInferenceRequest(parsed.data);
}

const featureRefusedSchema = z.object({
  n: z.number().optional(),
  audio: z.unknown().optional(),
  modalities: z.array(z.string()).optional(),
  web_search_options: z.unknown().optional(),
  functions: z.unknown().optional(),
  tools: z.array(z.object({ type: z.string().optional() })).optional(),
  messages: z
    .array(
      z.object({
        role: z.unknown(),
        content: z.union([z.array(z.object({ type: z.unknown() })), z.unknown()]),
      }),
    )
    .optional(),
});

const SUPPORTED_CONTENT_PARTS = new Set(["text", "image_url"]);

/** Features ADR 0002 keeps out of v1 get a 400 that names them, rather than being dropped. */
function refuseOutOfScopeFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return; // Malformed: the full schema explains it.
  }
  const { n, audio, modalities, web_search_options, functions, tools, messages } = features.data;
  if (n !== undefined && n !== 1) {
    throw unsupported("`n` other than 1 (several choices)");
  }
  if (audio !== undefined || modalities?.some((modality) => modality !== "text")) {
    throw unsupported("audio output (`audio`, `modalities`)");
  }
  if (web_search_options !== undefined) {
    throw unsupported("web search (`web_search_options`)");
  }
  if (functions !== undefined) {
    throw unsupported("legacy `functions`; use `tools`");
  }
  const otherTool = tools?.find((tool) => tool.type !== "function");
  if (otherTool) {
    throw unsupported(
      `tools of type \`${String(otherTool.type)}\`; only function tools are supported`,
    );
  }
  for (const message of messages ?? []) {
    if (message.role === "function") {
      throw unsupported("messages with role `function`; use `tool`");
    }
    if (!Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (typeof part.type === "string" && !SUPPORTED_CONTENT_PARTS.has(part.type)) {
        throw unsupported(`content parts of type \`${part.type}\``);
      }
    }
  }
}

function unsupported(feature: string): GatewayError {
  return new GatewayError("invalid_request", `Not supported: ${feature}`);
}

function toInferenceRequest(request: ClientRequest): InferenceRequest {
  const system: TextPart[] = [];
  const messages: InferenceMessage[] = [];
  // System and developer messages are hoisted, in order, ahead of the conversation.
  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") {
      system.push(...textParts(message.content));
    } else {
      messages.push(toInferenceMessage(message));
    }
  }

  const parsed: InferenceRequest = {
    model: request.model,
    system,
    messages,
    tools: (request.tools ?? []).map(({ function: tool }) => ({
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      parameters: tool.parameters ?? EMPTY_PARAMETERS_SCHEMA,
      ...(tool.strict != null && { strict: tool.strict }),
    })),
    stream: request.stream
      ? { includeUsage: request.stream_options?.include_usage === true }
      : null,
  };
  if (request.tool_choice !== undefined) {
    parsed.toolChoice = toToolChoice(request.tool_choice);
  }
  if (request.parallel_tool_calls !== undefined) {
    parsed.parallelToolCalls = request.parallel_tool_calls;
  }
  if (request.response_format !== undefined) {
    parsed.responseFormat = toResponseFormat(request.response_format);
  }
  if (request.reasoning_effort !== undefined) {
    parsed.reasoning = { effort: request.reasoning_effort };
  }
  const maxOutputTokens = request.max_completion_tokens ?? request.max_tokens;
  if (maxOutputTokens != null) {
    parsed.maxOutputTokens = maxOutputTokens;
  }
  if (request.temperature != null) {
    parsed.temperature = request.temperature;
  }
  if (request.top_p != null) {
    parsed.topP = request.top_p;
  }
  if (request.stop != null) {
    parsed.stopSequences = typeof request.stop === "string" ? [request.stop] : request.stop;
  }
  return parsed;
}

function textParts(content: z.infer<typeof textContentSchema>): TextPart[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map((part) => ({ type: "text", text: part.text }));
}

function toInferenceMessage(
  message: Exclude<ClientMessage, { role: "system" | "developer" }>,
): InferenceMessage {
  switch (message.role) {
    case "user":
      return { role: "user", content: toUserContent(message.content) };
    case "tool":
      return {
        role: "tool",
        toolCallId: message.tool_call_id,
        content: textParts(message.content),
      };
    case "assistant": {
      const content: AssistantContentPart[] = [];
      if (message.reasoning_content) {
        content.push({ type: "reasoning", text: message.reasoning_content });
      }
      if (message.content) {
        content.push(...textParts(message.content));
      }
      for (const call of message.tool_calls ?? []) {
        content.push({
          type: "tool-call",
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
      return { role: "assistant", content };
    }
  }
}

function toUserContent(
  content: Extract<ClientMessage, { role: "user" }>["content"],
): UserContentPart[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map((part): UserContentPart => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    const dataUrl = DATA_URL.exec(part.image_url.url);
    if (dataUrl) {
      return { type: "image", source: { type: "base64", mediaType: dataUrl[1], data: dataUrl[2] } };
    }
    return { type: "image", source: { type: "url", url: part.image_url.url } };
  });
}

function toToolChoice(choice: NonNullable<ClientRequest["tool_choice"]>): ToolChoice {
  return typeof choice === "string"
    ? { type: choice }
    : { type: "tool", name: choice.function.name };
}

function toResponseFormat(format: NonNullable<ClientRequest["response_format"]>): ResponseFormat {
  switch (format.type) {
    case "text":
      return { type: "text" };
    case "json_object":
      return { type: "json-object" };
    case "json_schema":
      return {
        type: "json-schema",
        name: format.json_schema.name,
        schema: format.json_schema.schema ?? {},
        ...(format.json_schema.strict != null && { strict: format.json_schema.strict }),
      };
  }
}

function writeResponse(
  response: InferenceResponse,
  _request: InferenceRequest,
  context: ResponseContext,
): unknown {
  const text = response.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  const reasoning = response.content
    .flatMap((part) => (part.type === "reasoning" ? [part.text] : []))
    .join("");
  const toolCalls = response.content.flatMap((part) => (part.type === "tool-call" ? [part] : []));

  const message: Record<string, unknown> = {
    role: "assistant",
    content: text === "" ? null : text,
  };
  if (reasoning !== "") {
    message.reasoning_content = reasoning;
  }
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return {
    ...responseHeader(context, "chat.completion"),
    choices: [
      { index: 0, message, logprobs: null, finish_reason: finishReasonOf(response.stopReason) },
    ],
    usage: writeUsage(response.usage),
  };
}

function responseHeader(context: ResponseContext, object: string): Record<string, unknown> {
  return {
    id: `${COMPLETION_ID_PREFIX}${context.requestId}`,
    object,
    created: Math.floor(context.createdAt.getTime() / 1000),
    model: context.modelName,
  };
}

async function* writeStream(
  events: AsyncIterable<InferenceStreamEvent>,
  request: InferenceRequest,
  context: ResponseContext,
): AsyncIterable<string> {
  const header = responseHeader(context, "chat.completion.chunk");
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null): string =>
    serverSentEvent({
      ...header,
      choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    });

  let usage: TokenUsage | undefined;
  yield chunk({ role: "assistant", content: "" });
  for await (const event of events) {
    if (event.type === "usage") {
      usage = event.usage;
      continue;
    }
    const written = writeStreamEvent(event, chunk);
    if (written !== null) {
      yield written;
    }
  }
  // Usage goes last, in a chunk without choices, as OpenAI sends it.
  if (request.stream?.includeUsage && usage) {
    yield serverSentEvent({ ...header, choices: [], usage: writeUsage(usage) });
  }
  yield "data: [DONE]\n\n";
}

function writeStreamEvent(
  event: Exclude<InferenceStreamEvent, { type: "usage" }>,
  chunk: (delta: Record<string, unknown>, finishReason?: string | null) => string,
): string | null {
  switch (event.type) {
    case "text-delta":
      return chunk({ content: event.text });
    case "reasoning-delta":
      return chunk({ reasoning_content: event.text });
    case "tool-call-start":
      return chunk({
        tool_calls: [
          {
            index: event.index,
            id: event.id,
            type: "function",
            function: { name: event.name, arguments: "" },
          },
        ],
      });
    case "tool-call-delta":
      return chunk({
        tool_calls: [{ index: event.index, function: { arguments: event.argumentsDelta } }],
      });
    case "finish":
      return chunk({}, finishReasonOf(event.stopReason));
    case "reasoning-signature":
      // Chat Completions has nowhere to carry a reasoning signature.
      return null;
  }
}

function serverSentEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function errorTypeOf(status: number): string {
  if (status >= 500) {
    return "server_error";
  }
  if (status === 429) {
    return "rate_limit_error";
  }
  return "invalid_request_error";
}

function writeError(error: GatewayError): unknown {
  return {
    error: {
      message: error.message,
      type: errorTypeOf(error.status),
      param: null,
      code: error.code,
    },
  };
}

/** OpenAI ends a failed stream with the error envelope as a data line, and no `[DONE]`. */
function writeStreamError(error: GatewayError): string {
  return serverSentEvent(writeError(error));
}

export const openAiChatClientConverter: ClientProtocolConverter = {
  protocol: "openai-chat",
  parseRequest,
  writeResponse,
  writeStream,
  writeError,
  writeStreamError,
};
