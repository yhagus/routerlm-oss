import { z } from "zod";
import type {
  AssistantContentPart,
  InferenceResponse,
  InferenceStreamEvent,
  StopReason,
  TokenUsage,
} from "../../models/internal-format.js";
import { readServerSentEvents } from "../server-sent-events.js";
import { UpstreamProtocolError } from "../upstream-protocol-converter.js";

// Responses are read leniently: only the fields the internal format needs.
// Block types it can't express (redacted_thinking, server tool blocks) are skipped.

const usageSchema = z.object({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
});
type MessagesUsage = z.infer<typeof usageSchema>;

const stopReasonSchema = z.string().nullish();

const STOP_REASONS: Record<string, StopReason> = {
  end_turn: "end",
  max_tokens: "max-tokens",
  model_context_window_exceeded: "max-tokens",
  stop_sequence: "stop-sequence",
  tool_use: "tool-calls",
  refusal: "content-filter",
  // Only server tools pause a turn; to a client the turn is over.
  pause_turn: "end",
};

function stopReasonOf(stopReason: string | null | undefined): StopReason {
  return (stopReason && STOP_REASONS[stopReason]) || "end";
}

/** `input_tokens` already excludes the cached input, as TokenUsage does. */
function tokenUsageOf(usage: MessagesUsage): TokenUsage {
  const inputTokens = usage.input_tokens ?? null;
  // Providers that copy the Protocol often leave the cache counts out when nothing was cached.
  const zeroWhenInputKnown = inputTokens === null ? null : 0;
  return {
    inputTokens,
    outputTokens: usage.output_tokens ?? null,
    cacheReadTokens: usage.cache_read_input_tokens ?? zeroWhenInputKnown,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? zeroWhenInputKnown,
    reasoningTokens: null,
  };
}

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
]);

const messageSchema = z.object({
  content: z.array(z.object({ type: z.string() }).loose()),
  stop_reason: stopReasonSchema,
  usage: usageSchema,
});

export function parseMessagesResponse(body: unknown): InferenceResponse {
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamProtocolError(`Not a message: ${parsed.error.message}`);
  }
  const content: AssistantContentPart[] = [];
  for (const rawBlock of parsed.data.content) {
    const block = contentBlockSchema.safeParse(rawBlock);
    if (!block.success) {
      continue;
    }
    switch (block.data.type) {
      case "text":
        content.push({ type: "text", text: block.data.text });
        break;
      case "thinking":
        content.push({
          type: "reasoning",
          text: block.data.thinking,
          signature: block.data.signature,
        });
        break;
      case "tool_use":
        content.push({
          type: "tool-call",
          id: block.data.id,
          name: block.data.name,
          arguments: JSON.stringify(block.data.input),
        });
        break;
    }
  }
  return {
    content,
    stopReason: stopReasonOf(parsed.data.stop_reason),
    usage: tokenUsageOf(parsed.data.usage),
  };
}

const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_start"), message: z.object({ usage: usageSchema }) }),
  z.object({
    type: z.literal("content_block_start"),
    index: z.number(),
    content_block: z.object({ type: z.string() }).loose(),
  }),
  z.object({
    type: z.literal("content_block_delta"),
    index: z.number(),
    delta: z.object({ type: z.string() }).loose(),
  }),
  z.object({ type: z.literal("content_block_stop") }),
  z.object({
    type: z.literal("message_delta"),
    delta: z.object({ stop_reason: stopReasonSchema }),
    usage: usageSchema.nullish(),
  }),
  z.object({ type: z.literal("message_stop") }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("error"), error: z.unknown() }),
]);
type StreamEvent = z.infer<typeof streamEventSchema>;
const KNOWN_STREAM_EVENT_TYPES: ReadonlySet<string> = new Set(
  streamEventSchema.options.map((option) => option.shape.type.value),
);

const toolUseStartSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
});

const deltaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string() }),
  z.object({ type: z.literal("thinking_delta"), thinking: z.string() }),
  z.object({ type: z.literal("signature_delta"), signature: z.string() }),
  z.object({ type: z.literal("input_json_delta"), partial_json: z.string() }),
]);

/**
 * What a stream has told so far. Content blocks are numbered across all
 * types; tool calls are numbered among themselves, as the internal format wants.
 */
class StreamState {
  usage: MessagesUsage = {};
  private readonly toolCallIndexByBlock = new Map<number, number>();

  startToolCall(blockIndex: number): number {
    const toolCallIndex = this.toolCallIndexByBlock.size;
    this.toolCallIndexByBlock.set(blockIndex, toolCallIndex);
    return toolCallIndex;
  }

  toolCallIndexOf(blockIndex: number): number | undefined {
    return this.toolCallIndexByBlock.get(blockIndex);
  }

  /** message_delta counts are cumulative and may restate the input counts. */
  updateUsage(update: MessagesUsage): void {
    this.usage = {
      input_tokens: update.input_tokens ?? this.usage.input_tokens,
      output_tokens: update.output_tokens ?? this.usage.output_tokens,
      cache_creation_input_tokens:
        update.cache_creation_input_tokens ?? this.usage.cache_creation_input_tokens,
      cache_read_input_tokens: update.cache_read_input_tokens ?? this.usage.cache_read_input_tokens,
    };
  }
}

export async function* parseMessagesStream(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<InferenceStreamEvent> {
  const state = new StreamState();
  for await (const { data } of readServerSentEvents(body)) {
    const event = parseStreamEvent(data);
    if (!event) {
      continue;
    }
    if (event.type === "message_stop") {
      yield { type: "usage", usage: tokenUsageOf(state.usage) };
      return;
    }
    yield* eventsOf(event, state);
  }
  throw new UpstreamProtocolError("The stream ended before message_stop");
}

const typedEventSchema = z.object({ type: z.string() });

/** Null for an event type this reader doesn't know: the Protocol adds new ones over time. */
function parseStreamEvent(data: string): StreamEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch (error) {
    throw new UpstreamProtocolError("A stream event is not JSON", { cause: error });
  }
  const typed = typedEventSchema.safeParse(json);
  if (typed.success && !KNOWN_STREAM_EVENT_TYPES.has(typed.data.type)) {
    return null;
  }
  const event = streamEventSchema.safeParse(json);
  if (!event.success) {
    throw new UpstreamProtocolError(`Not a messages stream event: ${event.error.message}`);
  }
  return event.data;
}

function* eventsOf(event: StreamEvent, state: StreamState): Iterable<InferenceStreamEvent> {
  switch (event.type) {
    case "message_start":
      state.updateUsage(event.message.usage);
      return;
    case "content_block_start": {
      const toolUse = toolUseStartSchema.safeParse(event.content_block);
      if (toolUse.success) {
        const index = state.startToolCall(event.index);
        yield { type: "tool-call-start", index, id: toolUse.data.id, name: toolUse.data.name };
      }
      return;
    }
    case "content_block_delta":
      yield* eventsOfDelta(event.index, event.delta, state);
      return;
    case "message_delta":
      state.updateUsage(event.usage ?? {});
      if (event.delta.stop_reason) {
        yield { type: "finish", stopReason: stopReasonOf(event.delta.stop_reason) };
      }
      return;
    case "error":
      throw new UpstreamProtocolError(
        `The upstream reported an error mid-stream: ${JSON.stringify(event.error)}`,
      );
    case "content_block_stop":
    case "message_stop":
    case "ping":
      return;
  }
}

function* eventsOfDelta(
  blockIndex: number,
  rawDelta: unknown,
  state: StreamState,
): Iterable<InferenceStreamEvent> {
  const delta = deltaSchema.safeParse(rawDelta);
  if (!delta.success) {
    return;
  }
  switch (delta.data.type) {
    case "text_delta":
      yield { type: "text-delta", text: delta.data.text };
      return;
    case "thinking_delta":
      yield { type: "reasoning-delta", text: delta.data.thinking };
      return;
    case "signature_delta":
      yield { type: "reasoning-signature", signature: delta.data.signature };
      return;
    case "input_json_delta": {
      const index = state.toolCallIndexOf(blockIndex);
      if (index !== undefined && delta.data.partial_json !== "") {
        yield { type: "tool-call-delta", index, argumentsDelta: delta.data.partial_json };
      }
      return;
    }
  }
}
