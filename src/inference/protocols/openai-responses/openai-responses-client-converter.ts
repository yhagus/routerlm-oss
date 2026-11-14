import { z } from "zod";
import { GatewayError } from "../../gateway-error.js";
import {
  type AssistantContentPart,
  type InferenceMessage,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceStreamEvent,
  type ReasoningEffort,
  type ReasoningPart,
  type ResponseFormat,
  type StopReason,
  type TextPart,
  type TokenUsage,
  type ToolCallPart,
  type ToolChoice,
  UNREPORTED_USAGE,
  type UserContentPart,
} from "../../internal-format.js";
import type { ClientProtocolConverter, ResponseContext } from "../client-protocol-converter.js";
import { openAiChatClientConverter } from "../openai-chat/openai-chat-client-converter.js";

// The Responses client Protocol (`POST /v1/responses`), stateless only (ADR 0002).
// Schemas are plain (non-strict) zod objects: unknown fields are dropped.

const inputTextSchema = z.object({ type: z.literal("input_text"), text: z.string() });
const inputImageSchema = z.object({
  type: z.literal("input_image"),
  image_url: z.string().min(1),
});
const outputTextSchema = z.object({ type: z.literal("output_text"), text: z.string() });
const refusalSchema = z.object({ type: z.literal("refusal"), refusal: z.string() });

const userContentSchema = z.union([
  z.string(),
  z.array(z.discriminatedUnion("type", [inputTextSchema, inputImageSchema])),
]);
const instructionContentSchema = z.union([z.string(), z.array(inputTextSchema)]);
const assistantContentSchema = z.union([
  z.string(),
  z.array(z.discriminatedUnion("type", [outputTextSchema, inputTextSchema, refusalSchema])),
]);

// A message's `type` is optional on the wire, so messages are told apart by role.
const messageItemSchema = z.discriminatedUnion("role", [
  z.object({
    type: z.literal("message").optional(),
    role: z.literal("user"),
    content: userContentSchema,
  }),
  z.object({
    type: z.literal("message").optional(),
    role: z.enum(["system", "developer"]),
    content: instructionContentSchema,
  }),
  z.object({
    type: z.literal("message").optional(),
    role: z.literal("assistant"),
    content: assistantContentSchema,
  }),
]);

const reasoningTextSchema = z.object({ text: z.string() });
const reasoningItemSchema = z.object({
  type: z.literal("reasoning"),
  summary: z.array(reasoningTextSchema).optional(),
  content: z.array(reasoningTextSchema).nullish(),
  encrypted_content: z.string().nullish(),
});
const functionCallItemSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
});
const functionCallOutputItemSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().min(1),
  output: userContentSchema,
});

const inputItemSchema = z.union([
  messageItemSchema,
  reasoningItemSchema,
  functionCallItemSchema,
  functionCallOutputItemSchema,
]);
type InputItem = z.infer<typeof inputItemSchema>;

const CLIENT_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ClientEffort = (typeof CLIENT_EFFORTS)[number];

/** `max` has no higher internal level than `xhigh`. */
const CLIENT_EFFORT_LEVELS = {
  none: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
} as const satisfies Record<ClientEffort, ReasoningEffort>;

const requestSchema = z.object({
  model: z.string().min(1),
  instructions: z.string().nullish(),
  input: z.union([z.string(), z.array(inputItemSchema).min(1)]),
  tools: z
    .array(
      z.object({
        type: z.literal("function"),
        name: z.string().min(1),
        description: z.string().nullish(),
        parameters: z.record(z.string(), z.unknown()).nullish(),
        strict: z.boolean().nullish(),
      }),
    )
    .optional(),
  tool_choice: z
    .union([
      z.enum(["auto", "none", "required"]),
      z.object({ type: z.literal("function"), name: z.string().min(1) }),
    ])
    .optional(),
  parallel_tool_calls: z.boolean().nullish(),
  text: z
    .object({
      format: z
        .discriminatedUnion("type", [
          z.object({ type: z.literal("text") }),
          z.object({ type: z.literal("json_object") }),
          z.object({
            type: z.literal("json_schema"),
            name: z.string().min(1),
            schema: z.record(z.string(), z.unknown()),
            strict: z.boolean().nullish(),
          }),
        ])
        .optional(),
    })
    .optional(),
  reasoning: z.object({ effort: z.enum(CLIENT_EFFORTS).nullish() }).nullish(),
  max_output_tokens: z.int().positive().nullish(),
  temperature: z.number().min(0).max(2).nullish(),
  top_p: z.number().min(0).max(1).nullish(),
  stream: z.boolean().nullish(),
});
type ClientRequest = z.infer<typeof requestSchema>;

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

const typedSchema = z.object({ type: z.unknown() }).loose();
const featureRefusedSchema = z.object({
  store: z.unknown().optional(),
  previous_response_id: z.unknown().optional(),
  conversation: z.unknown().optional(),
  background: z.unknown().optional(),
  prompt: z.unknown().optional(),
  tools: z.array(typedSchema).optional(),
  input: z.union([
    z.array(z.object({ type: z.unknown(), content: z.unknown(), output: z.unknown() }).loose()),
    z.unknown(),
  ]),
});

const SUPPORTED_INPUT_ITEMS = new Set([
  undefined,
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
]);
const SUPPORTED_CONTENT_PARTS = new Set(["input_text", "input_image", "output_text", "refusal"]);
const SEND_THE_CONVERSATION = "the gateway is stateless, so send the whole conversation in `input`";

/**
 * Features ADR 0002 keeps out of v1 get a 400 that names them, rather than
 * being dropped: stateful features (the gateway stores no responses) and
 * anything the internal format can't carry, such as provider-hosted tools.
 */
function refuseOutOfScopeFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return; // Malformed: the full schema explains it.
  }
  const { store, previous_response_id, conversation, background, prompt, tools, input } =
    features.data;
  if (store === true) {
    throw unsupported(`stored responses (\`store: true\`); ${SEND_THE_CONVERSATION}`);
  }
  if (previous_response_id != null) {
    throw unsupported(`\`previous_response_id\`; ${SEND_THE_CONVERSATION}`);
  }
  if (conversation != null) {
    throw unsupported(`stored conversations (\`conversation\`); ${SEND_THE_CONVERSATION}`);
  }
  if (background === true) {
    throw unsupported("background mode (`background`)");
  }
  if (prompt != null) {
    throw unsupported("stored prompts (`prompt`)");
  }
  const otherTool = tools?.find((tool) => tool.type !== "function");
  if (otherTool) {
    throw unsupported(
      `tools of type \`${String(otherTool.type)}\`; only function tools are supported`,
    );
  }
  if (Array.isArray(input)) {
    input.forEach(refuseUnsupportedItem);
  }
}

function refuseUnsupportedItem(item: { type: unknown; content: unknown; output: unknown }): void {
  if (!SUPPORTED_INPUT_ITEMS.has(typeof item.type === "string" ? item.type : undefined)) {
    throw unsupported(`input items of type \`${String(item.type)}\``);
  }
  if (item.type === "reasoning") {
    return; // Its content parts are reasoning text, not message content.
  }
  const parts = z
    .array(typedSchema)
    .safeParse(item.type === "function_call_output" ? item.output : item.content);
  for (const part of parts.success ? parts.data : []) {
    if (typeof part.type === "string" && !SUPPORTED_CONTENT_PARTS.has(part.type)) {
      throw unsupported(`content parts of type \`${part.type}\``);
    }
    if (part.type === "input_image" && part.image_url == null) {
      throw unsupported("images by `file_id`; send an `image_url` (a URL or a data URL)");
    }
  }
}

function unsupported(feature: string): GatewayError {
  return new GatewayError("invalid_request", `Not supported: ${feature}`);
}

function toInferenceRequest(request: ClientRequest): InferenceRequest {
  const system: TextPart[] = [];
  if (request.instructions) {
    system.push({ type: "text", text: request.instructions });
  }
  const items: InputItem[] =
    typeof request.input === "string" ? [{ role: "user", content: request.input }] : request.input;
  const messages: InferenceMessage[] = [];
  for (const item of items) {
    if (isInstruction(item)) {
      // Instructions inside the input are hoisted, in order, like `instructions`.
      system.push(...textParts(item.content));
    } else {
      appendItem(messages, item);
    }
  }

  const parsed: InferenceRequest = {
    model: request.model,
    system,
    messages,
    tools: (request.tools ?? []).map((tool) => ({
      name: tool.name,
      ...(tool.description != null && { description: tool.description }),
      parameters: tool.parameters ?? EMPTY_PARAMETERS_SCHEMA,
      ...(tool.strict != null && { strict: tool.strict }),
    })),
    // The Protocol always reports usage in its last stream event.
    stream: request.stream ? { includeUsage: true } : null,
  };
  if (request.tool_choice !== undefined) {
    parsed.toolChoice = toToolChoice(request.tool_choice);
  }
  if (request.parallel_tool_calls != null) {
    parsed.parallelToolCalls = request.parallel_tool_calls;
  }
  if (request.text?.format !== undefined) {
    parsed.responseFormat = toResponseFormat(request.text.format);
  }
  if (request.reasoning?.effort != null) {
    parsed.reasoning = { effort: CLIENT_EFFORT_LEVELS[request.reasoning.effort] };
  }
  if (request.max_output_tokens != null) {
    parsed.maxOutputTokens = request.max_output_tokens;
  }
  if (request.temperature != null) {
    parsed.temperature = request.temperature;
  }
  if (request.top_p != null) {
    parsed.topP = request.top_p;
  }
  return parsed;
}

type InstructionItem = Extract<InputItem, { role: "system" | "developer" }>;
type ConversationItem = Exclude<InputItem, InstructionItem>;

function isInstruction(item: InputItem): item is InstructionItem {
  return "role" in item && (item.role === "system" || item.role === "developer");
}

/**
 * Adds one input item to the conversation. The Protocol lists an assistant
 * turn's reasoning, text and function calls as separate items, so consecutive
 * ones are gathered into one assistant message.
 */
function appendItem(messages: InferenceMessage[], item: ConversationItem): void {
  if ("role" in item && item.role === "user") {
    messages.push({ role: "user", content: userContent(item.content) });
    return;
  }
  if (item.type === "function_call_output") {
    messages.push({ role: "tool", toolCallId: item.call_id, content: userContent(item.output) });
    return;
  }
  const last = messages.at(-1);
  const assistant = last?.role === "assistant" ? last : { role: "assistant" as const, content: [] };
  if (assistant !== last) {
    messages.push(assistant);
  }
  assistant.content.push(...assistantParts(item));
}

function assistantParts(
  item: Exclude<ConversationItem, { role: "user" } | { type: "function_call_output" }>,
): AssistantContentPart[] {
  if ("role" in item) {
    if (typeof item.content === "string") {
      return [{ type: "text", text: item.content }];
    }
    return item.content.map((part) => ({
      type: "text",
      text: part.type === "refusal" ? part.refusal : part.text,
    }));
  }
  if (item.type === "function_call") {
    return [{ type: "tool-call", id: item.call_id, name: item.name, arguments: item.arguments }];
  }
  // Raw reasoning text when the item has it, else its summary.
  const texts = item.content?.length ? item.content : (item.summary ?? []);
  return [
    {
      type: "reasoning",
      text: texts.map((text) => text.text).join("\n\n"),
      ...(item.encrypted_content && { signature: item.encrypted_content }),
    },
  ];
}

function textParts(content: z.infer<typeof instructionContentSchema>): TextPart[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map((part) => ({ type: "text", text: part.text }));
}

function userContent(content: z.infer<typeof userContentSchema>): UserContentPart[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map((part): UserContentPart => {
    if (part.type === "input_text") {
      return { type: "text", text: part.text };
    }
    const dataUrl = DATA_URL.exec(part.image_url);
    if (dataUrl) {
      return { type: "image", source: { type: "base64", mediaType: dataUrl[1], data: dataUrl[2] } };
    }
    return { type: "image", source: { type: "url", url: part.image_url } };
  });
}

function toToolChoice(choice: NonNullable<ClientRequest["tool_choice"]>): ToolChoice {
  return typeof choice === "string" ? { type: choice } : { type: "tool", name: choice.name };
}

function toResponseFormat(
  format: NonNullable<NonNullable<ClientRequest["text"]>["format"]>,
): ResponseFormat {
  switch (format.type) {
    case "text":
      return { type: "text" };
    case "json_object":
      return { type: "json-object" };
    case "json_schema":
      return {
        type: "json-schema",
        name: format.name,
        schema: format.schema,
        ...(format.strict != null && { strict: format.strict }),
      };
  }
}

const RESPONSE_ID_PREFIX = "resp_";
const ITEM_ID_PREFIXES = { message: "msg_", reasoning: "rs_", function_call: "fc_" } as const;
type OutputItemType = keyof typeof ITEM_ID_PREFIXES;
type ItemStatus = "in_progress" | "completed";

/** Why a response stopped early; any other stop reason completes it. */
const INCOMPLETE_REASONS: Partial<Record<StopReason, string>> = {
  "max-tokens": "max_output_tokens",
  "content-filter": "content_filter",
};

/** How a response ended; null while a stream is still running. */
type ResponseEnding = { stopReason: StopReason; usage: TokenUsage } | null;

function writeResponse(
  response: InferenceResponse,
  request: InferenceRequest,
  context: ResponseContext,
): unknown {
  const output = mergeTextParts(response.content).map((part, outputIndex) => {
    const id = outputItemId(context, outputItemTypeOf(part), outputIndex);
    switch (part.type) {
      case "text":
        return messageItem(id, "completed", part.text);
      case "reasoning":
        return reasoningItem(id, "completed", part);
      case "tool-call":
        return functionCallItem(id, "completed", part);
    }
  });
  return responseObject(request, context, output, response);
}

/** The Protocol's message item holds a whole run of text, so adjacent text parts become one. */
function mergeTextParts(content: AssistantContentPart[]): AssistantContentPart[] {
  const merged: AssistantContentPart[] = [];
  for (const part of content) {
    const previous = merged.at(-1);
    if (part.type === "text" && previous?.type === "text") {
      merged[merged.length - 1] = { type: "text", text: previous.text + part.text };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function outputItemTypeOf(part: AssistantContentPart): OutputItemType {
  switch (part.type) {
    case "text":
      return "message";
    case "reasoning":
      return "reasoning";
    case "tool-call":
      return "function_call";
  }
}

/** Item ids are ours: the response id plus the item's position in the output. */
function outputItemId(context: ResponseContext, type: OutputItemType, outputIndex: number): string {
  return `${ITEM_ID_PREFIXES[type]}${context.requestId}_${outputIndex}`;
}

function messageItem(id: string, status: ItemStatus, text: string | null): Record<string, unknown> {
  return {
    id,
    type: "message",
    status,
    role: "assistant",
    content: text === null ? [] : [outputTextPart(text)],
  };
}

function outputTextPart(text: string): Record<string, unknown> {
  return { type: "output_text", text, annotations: [], logprobs: [] };
}

/**
 * Upstream reasoning is the model's raw thinking, so it goes in `content` as
 * reasoning text, not in `summary`. A signature travels as `encrypted_content`,
 * which clients send back with the item.
 */
function reasoningItem(
  id: string,
  status: ItemStatus,
  reasoning: Omit<ReasoningPart, "type"> | null,
): Record<string, unknown> {
  return {
    id,
    type: "reasoning",
    status,
    summary: [],
    content: reasoning === null ? [] : [reasoningTextPart(reasoning.text)],
    ...(reasoning?.signature && { encrypted_content: reasoning.signature }),
  };
}

function reasoningTextPart(text: string): Record<string, unknown> {
  return { type: "reasoning_text", text };
}

function functionCallItem(
  id: string,
  status: ItemStatus,
  call: Omit<ToolCallPart, "type">,
): Record<string, unknown> {
  return {
    id,
    type: "function_call",
    status,
    call_id: call.id,
    name: call.name,
    arguments: call.arguments,
  };
}

/**
 * The response object. Settings are echoed from the parsed request; the
 * gateway stores nothing, so `store` is always false.
 */
function responseObject(
  request: InferenceRequest,
  context: ResponseContext,
  output: unknown[],
  ending: ResponseEnding,
): Record<string, unknown> {
  const incompleteReason = ending && INCOMPLETE_REASONS[ending.stopReason];
  return {
    id: `${RESPONSE_ID_PREFIX}${context.requestId}`,
    object: "response",
    created_at: Math.floor(context.createdAt.getTime() / 1000),
    status: responseStatusOf(ending),
    error: null,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    instructions: null,
    metadata: {},
    model: context.modelName,
    output,
    parallel_tool_calls: request.parallelToolCalls ?? true,
    temperature: request.temperature ?? null,
    tool_choice: writeToolChoice(request.toolChoice),
    tools: request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description ?? null,
      parameters: tool.parameters,
      strict: tool.strict ?? null,
    })),
    top_p: request.topP ?? null,
    max_output_tokens: request.maxOutputTokens ?? null,
    previous_response_id: null,
    reasoning: { effort: request.reasoning?.effort ?? null, summary: null },
    store: false,
    text: { format: writeResponseFormat(request.responseFormat) },
    truncation: "disabled",
    usage: ending === null ? null : writeUsage(ending.usage),
  };
}

function responseStatusOf(ending: ResponseEnding): "in_progress" | "completed" | "incomplete" {
  if (ending === null) {
    return "in_progress";
  }
  return INCOMPLETE_REASONS[ending.stopReason] === undefined ? "completed" : "incomplete";
}

function writeToolChoice(choice: ToolChoice | undefined): unknown {
  if (choice === undefined) {
    return "auto";
  }
  return choice.type === "tool" ? { type: "function", name: choice.name } : choice.type;
}

function writeResponseFormat(format: ResponseFormat | undefined): Record<string, unknown> {
  switch (format?.type) {
    case undefined:
    case "text":
      return { type: "text" };
    case "json-object":
      return { type: "json_object" };
    case "json-schema":
      return {
        type: "json_schema",
        name: format.name,
        schema: format.schema,
        strict: format.strict ?? null,
      };
  }
}

/** The Protocol's input count includes the cached input; counts never reported are written as 0. */
function writeUsage(usage: TokenUsage): Record<string, unknown> {
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const inputTokens = (usage.inputTokens ?? 0) + cacheReadTokens + cacheWriteTokens;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: cacheReadTokens, cache_write_tokens: cacheWriteTokens },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
    total_tokens: inputTokens + outputTokens,
  };
}

/**
 * Stream events are the Protocol's numbered events: the response is created,
 * each output item is added, filled with deltas and done before the next one
 * starts, and the whole response comes last. The stop reason and usage arrive
 * in any order, so both are held until the stream ends.
 */
async function* writeStream(
  events: AsyncIterable<InferenceStreamEvent>,
  request: InferenceRequest,
  context: ResponseContext,
): AsyncIterable<string> {
  const writer = new ResponseEventWriter(request, context);
  yield writer.lifecycleEvent("response.created", null);
  yield writer.lifecycleEvent("response.in_progress", null);
  let stopReason: StopReason = "end";
  let usage = UNREPORTED_USAGE;
  for await (const event of events) {
    if (event.type === "finish") {
      stopReason = event.stopReason;
    } else if (event.type === "usage") {
      usage = event.usage;
    } else {
      yield* writer.write(event);
    }
  }
  yield* writer.closeOpenItem();
  const ending = { stopReason, usage };
  yield writer.lifecycleEvent(
    responseStatusOf(ending) === "completed" ? "response.completed" : "response.incomplete",
    ending,
  );
}

type ContentEvent = Exclude<InferenceStreamEvent, { type: "finish" | "usage" }>;

interface OpenItemPosition {
  id: string;
  outputIndex: number;
}
type OpenMessage = OpenItemPosition & { type: "message"; text: string };
type OpenReasoning = OpenItemPosition & { type: "reasoning"; text: string; signature?: string };
type OpenFunctionCall = OpenItemPosition & {
  type: "function_call";
  toolIndex: number;
  call: Omit<ToolCallPart, "type">;
};
type OpenItem = OpenMessage | OpenReasoning | OpenFunctionCall;

/** The only content part of a message or reasoning item the gateway writes. */
const CONTENT_INDEX = 0;

/**
 * Turns internal deltas into the Protocol's output items and numbers every
 * event. Finished items are kept for the response that ends the stream.
 */
class ResponseEventWriter {
  private sequenceNumber = 0;
  private open: OpenItem | null = null;
  private readonly finishedItems: Record<string, unknown>[] = [];

  constructor(
    private readonly request: InferenceRequest,
    private readonly context: ResponseContext,
  ) {}

  lifecycleEvent(type: string, ending: ResponseEnding): string {
    const output = ending === null ? [] : this.finishedItems;
    return this.event(type, {
      response: responseObject(this.request, this.context, output, ending),
    });
  }

  *write(event: ContentEvent): Generator<string> {
    switch (event.type) {
      case "text-delta": {
        const message = this.open?.type === "message" ? this.open : yield* this.startMessage();
        message.text += event.text;
        yield this.event("response.output_text.delta", {
          ...this.contentPosition(message),
          delta: event.text,
          logprobs: [],
        });
        return;
      }
      case "reasoning-delta": {
        const reasoning = yield* this.unsignedReasoning();
        reasoning.text += event.text;
        yield this.event("response.reasoning_text.delta", {
          ...this.contentPosition(reasoning),
          delta: event.text,
        });
        return;
      }
      case "reasoning-signature": {
        // The signature goes out with the item once it is done.
        const reasoning = yield* this.unsignedReasoning();
        reasoning.signature = event.signature;
        return;
      }
      case "tool-call-start":
        yield* this.startFunctionCall(event.index, { id: event.id, name: event.name });
        return;
      case "tool-call-delta": {
        const call = this.open;
        if (call?.type !== "function_call" || call.toolIndex !== event.index) {
          // A done item can't be reopened. Upstreams finish one call's
          // arguments before starting the next, so this means a broken stream.
          throw new GatewayError("upstream_error", "The upstream interleaved tool call arguments");
        }
        call.call.arguments += event.argumentsDelta;
        yield this.event("response.function_call_arguments.delta", {
          item_id: call.id,
          output_index: call.outputIndex,
          delta: event.argumentsDelta,
        });
        return;
      }
    }
  }

  *closeOpenItem(): Generator<string> {
    const item = this.open;
    if (item === null) {
      return;
    }
    this.open = null;
    let done: Record<string, unknown>;
    switch (item.type) {
      case "message": {
        const part = outputTextPart(item.text);
        yield this.event("response.output_text.done", {
          ...this.contentPosition(item),
          text: item.text,
          logprobs: [],
        });
        yield this.event("response.content_part.done", { ...this.contentPosition(item), part });
        done = messageItem(item.id, "completed", item.text);
        break;
      }
      case "reasoning": {
        yield this.event("response.reasoning_text.done", {
          ...this.contentPosition(item),
          text: item.text,
        });
        yield this.event("response.content_part.done", {
          ...this.contentPosition(item),
          part: reasoningTextPart(item.text),
        });
        done = reasoningItem(item.id, "completed", item);
        break;
      }
      case "function_call":
        yield this.event("response.function_call_arguments.done", {
          item_id: item.id,
          output_index: item.outputIndex,
          arguments: item.call.arguments,
        });
        done = functionCallItem(item.id, "completed", item.call);
        break;
    }
    this.finishedItems.push(done);
    yield this.event("response.output_item.done", { output_index: item.outputIndex, item: done });
  }

  private *startMessage(): Generator<string, OpenMessage> {
    const message: OpenMessage = {
      ...(yield* this.nextPosition("message")),
      type: "message",
      text: "",
    };
    this.open = message;
    yield this.itemAdded(message, messageItem(message.id, "in_progress", null));
    yield this.event("response.content_part.added", {
      ...this.contentPosition(message),
      part: outputTextPart(""),
    });
    return message;
  }

  /** A signature ends a reasoning item, so reasoning after it starts a new one. */
  private *unsignedReasoning(): Generator<string, OpenReasoning> {
    if (this.open?.type === "reasoning" && this.open.signature === undefined) {
      return this.open;
    }
    const reasoning: OpenReasoning = {
      ...(yield* this.nextPosition("reasoning")),
      type: "reasoning",
      text: "",
    };
    this.open = reasoning;
    yield this.itemAdded(reasoning, reasoningItem(reasoning.id, "in_progress", null));
    yield this.event("response.content_part.added", {
      ...this.contentPosition(reasoning),
      part: reasoningTextPart(""),
    });
    return reasoning;
  }

  private *startFunctionCall(
    toolIndex: number,
    call: Omit<ToolCallPart, "type" | "arguments">,
  ): Generator<string> {
    const functionCall: OpenFunctionCall = {
      ...(yield* this.nextPosition("function_call")),
      type: "function_call",
      toolIndex,
      call: { ...call, arguments: "" },
    };
    this.open = functionCall;
    yield this.itemAdded(
      functionCall,
      functionCallItem(functionCall.id, "in_progress", functionCall.call),
    );
  }

  /** Closes the open item; the next one takes the following output index. */
  private *nextPosition(type: OutputItemType): Generator<string, OpenItemPosition> {
    yield* this.closeOpenItem();
    const outputIndex = this.finishedItems.length;
    return { id: outputItemId(this.context, type, outputIndex), outputIndex };
  }

  private itemAdded(position: OpenItemPosition, item: Record<string, unknown>): string {
    return this.event("response.output_item.added", { output_index: position.outputIndex, item });
  }

  private contentPosition(item: OpenItemPosition): Record<string, unknown> {
    return { item_id: item.id, output_index: item.outputIndex, content_index: CONTENT_INDEX };
  }

  private event(type: string, fields: Record<string, unknown>): string {
    const data = { type, ...fields, sequence_number: this.sequenceNumber };
    this.sequenceNumber += 1;
    return namedEvent(type, data);
  }
}

function namedEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The Responses API answers errors in the same envelope as Chat Completions. */
function writeError(error: GatewayError): unknown {
  return openAiChatClientConverter.writeError(error);
}

/**
 * The Protocol's `error` stream event. It carries no `sequence_number`: the
 * hook gets only the error, and the official SDK raises on the event name.
 */
function writeStreamError(error: GatewayError): string {
  return namedEvent("error", {
    type: "error",
    code: error.code,
    message: error.message,
    param: null,
  });
}

export const openAiResponsesClientConverter: ClientProtocolConverter = {
  protocol: "openai-responses",
  parseRequest,
  writeResponse,
  writeStream,
  writeError,
  writeStreamError,
};
