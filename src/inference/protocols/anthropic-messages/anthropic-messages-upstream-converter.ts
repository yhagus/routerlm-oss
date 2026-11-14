import { GatewayError } from "../../models/gateway-error.js";
import type {
  AssistantContentPart,
  CacheMarker,
  FunctionTool,
  ImagePart,
  InferenceMessage,
  InferenceRequest,
  ReasoningEffort,
  ResponseFormat,
  TextPart,
  ToolCallPart,
  ToolChoice,
  UserContentPart,
} from "../../models/internal-format.js";
import type {
  UpstreamHttpRequest,
  UpstreamProtocolConverter,
  UpstreamTarget,
} from "../upstream-protocol-converter.js";
import { parseMessagesResponse, parseMessagesStream } from "./anthropic-messages-response.js";

const MESSAGES_PATH = "/v1/messages";
// The version every Anthropic-compatible Provider accepts; later versions
// refuse sampling parameters (temperature, top_p) on every model.
const ANTHROPIC_VERSION = "2023-06-01";
// The Protocol requires max_tokens; used when neither the client nor the
// Upstream Model sets a limit.
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** The Protocol has no "none" or "minimal" effort: "none" sends no thinking settings at all. */
const EFFORT_LEVELS = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
} as const satisfies Record<Exclude<ReasoningEffort, "none">, string>;

type ContentBlock = Record<string, unknown>;
type MessageParam = { role: "user" | "assistant"; content: ContentBlock[] };

// Key order here is the order on the wire: keep it fixed so the same request
// always gives the same bytes (upstream prompt caches compare prefixes, and
// thinking blocks are only accepted back after an unchanged prefix).

function writeRequest(request: InferenceRequest, target: UpstreamTarget): UpstreamHttpRequest {
  const body: Record<string, unknown> = {
    model: target.upstreamModelId,
    max_tokens: request.maxOutputTokens ?? target.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  const system = writeTextBlocks(request.system);
  if (system.length > 0) {
    body.system = system;
  }
  body.messages = writeMessages(request.messages);
  if (request.tools.length > 0) {
    body.tools = request.tools.map(writeTool);
    const toolChoice = writeToolChoice(request);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }
  const thinking = writeThinking(request.reasoning);
  if (thinking) {
    body.thinking = thinking;
  }
  const outputConfig = writeOutputConfig(request);
  if (outputConfig) {
    body.output_config = outputConfig;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.topP !== undefined) {
    body.top_p = request.topP;
  }
  if (request.stopSequences) {
    body.stop_sequences = request.stopSequences;
  }
  // Usage arrives in message_start and message_delta on every stream; nothing to ask for.
  if (request.stream) {
    body.stream = true;
  }
  return {
    url: `${target.baseUrl.replace(/\/+$/, "")}${MESSAGES_PATH}`,
    headers: { "content-type": "application/json", "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify(body),
  };
}

/**
 * Tool results go back as `tool_result` blocks in a user turn. Adjacent turns
 * of the same role are joined, so the results of parallel tool calls (and the
 * client's next words) share one user turn, as the Protocol expects.
 */
function writeMessages(messages: InferenceMessage[]): MessageParam[] {
  const written: MessageParam[] = [];
  for (const message of messages) {
    const next = writeMessage(message);
    const previous = written.at(-1);
    if (previous?.role === next.role) {
      previous.content.push(...next.content);
    } else {
      written.push(next);
    }
  }
  return written.filter((message) => message.content.length > 0);
}

function writeMessage(message: InferenceMessage): MessageParam {
  switch (message.role) {
    case "user":
      return { role: "user", content: writeUserBlocks(message.content) };
    case "tool":
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: writeUserBlocks(message.content),
          },
        ],
      };
    case "assistant":
      return { role: "assistant", content: message.content.flatMap(writeAssistantBlock) };
  }
}

function writeUserBlocks(content: UserContentPart[]): ContentBlock[] {
  return content.flatMap((part) =>
    part.type === "text" ? writeTextBlocks([part]) : [writeImageBlock(part)],
  );
}

/** The Protocol refuses empty text blocks, which other Protocols allow. */
function writeTextBlocks(parts: TextPart[]): ContentBlock[] {
  return parts
    .filter((part) => part.text !== "")
    .map((part) => withCacheControl({ type: "text", text: part.text }, part.cacheMarker));
}

function writeImageBlock(part: ImagePart): ContentBlock {
  const source =
    part.source.type === "url"
      ? { type: "url", url: part.source.url }
      : { type: "base64", media_type: part.source.mediaType, data: part.source.data };
  return withCacheControl({ type: "image", source }, part.cacheMarker);
}

function writeAssistantBlock(part: AssistantContentPart): ContentBlock[] {
  switch (part.type) {
    case "text":
      return writeTextBlocks([part]);
    case "reasoning":
      // Thinking is only accepted back with the signature the Protocol issued
      // for it; reasoning from another Protocol has none and is left out.
      return part.signature === undefined
        ? []
        : [{ type: "thinking", thinking: part.text, signature: part.signature }];
    case "tool-call":
      return [{ type: "tool_use", id: part.id, name: part.name, input: toolInputOf(part) }];
  }
}

function toolInputOf(call: ToolCallPart): Record<string, unknown> {
  let input: unknown;
  try {
    input = JSON.parse(call.arguments);
  } catch {
    input = undefined;
  }
  if (!isJsonObject(input)) {
    throw new GatewayError(
      "invalid_request",
      `The arguments of tool call ${call.id} must be a JSON object.`,
    );
  }
  return input;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeTool(tool: FunctionTool): ContentBlock {
  const definition: ContentBlock = { name: tool.name };
  if (tool.description !== undefined) {
    definition.description = tool.description;
  }
  definition.input_schema = tool.parameters;
  if (tool.strict !== undefined) {
    definition.strict = tool.strict;
  }
  return withCacheControl(definition, tool.cacheMarker);
}

function writeToolChoice(request: InferenceRequest): ContentBlock | undefined {
  const isParallelDisabled = request.parallelToolCalls === false;
  // Turning parallel calls off needs a tool_choice to carry the flag.
  const choice = request.toolChoice ?? (isParallelDisabled ? { type: "auto" } : undefined);
  if (!choice) {
    return undefined;
  }
  const written = toolChoiceBlockOf(choice);
  if (isParallelDisabled && choice.type !== "none") {
    written.disable_parallel_tool_use = true;
  }
  return written;
}

function toolChoiceBlockOf(choice: ToolChoice): ContentBlock {
  switch (choice.type) {
    case "auto":
      return { type: "auto" };
    case "none":
      return { type: "none" };
    case "required":
      return { type: "any" };
    case "tool":
      return { type: "tool", name: choice.name };
  }
}

/**
 * A budget goes as a fixed thinking budget (the models that take one refuse
 * effort levels); an effort level turns on adaptive thinking with a readable
 * summary, since the default display returns empty thinking text.
 */
function writeThinking(reasoning: InferenceRequest["reasoning"]): ContentBlock | undefined {
  if (reasoning?.budgetTokens !== undefined) {
    return { type: "enabled", budget_tokens: reasoning.budgetTokens };
  }
  if (reasoning?.effort === undefined || reasoning.effort === "none") {
    return undefined;
  }
  return { type: "adaptive", display: "summarized" };
}

function writeOutputConfig(request: InferenceRequest): ContentBlock | undefined {
  const outputConfig: ContentBlock = {};
  const effort = request.reasoning?.effort;
  if (request.reasoning?.budgetTokens === undefined && effort !== undefined && effort !== "none") {
    outputConfig.effort = EFFORT_LEVELS[effort];
  }
  const format = writeOutputFormat(request.responseFormat);
  if (format) {
    outputConfig.format = format;
  }
  return Object.keys(outputConfig).length > 0 ? outputConfig : undefined;
}

/**
 * Only a JSON schema has a counterpart. Plain JSON mode has none (the Protocol
 * needs a schema that closes every object), so it is left to the prompt.
 */
function writeOutputFormat(format: ResponseFormat | undefined): ContentBlock | undefined {
  if (format?.type !== "json-schema") {
    return undefined;
  }
  return { type: "json_schema", schema: format.schema };
}

function withCacheControl(block: ContentBlock, marker: CacheMarker | undefined): ContentBlock {
  if (!marker) {
    return block;
  }
  const cacheControl: ContentBlock = { type: "ephemeral" };
  if (marker.ttl !== undefined) {
    cacheControl.ttl = marker.ttl;
  }
  return { ...block, cache_control: cacheControl };
}

/** The `anthropic-messages` upstream Protocol: Anthropic Messages and the Providers that copy it. */
export const anthropicMessagesUpstreamConverter: UpstreamProtocolConverter = {
  protocol: "anthropic-messages",
  writeRequest,
  parseResponse: parseMessagesResponse,
  parseStream: parseMessagesStream,
};
