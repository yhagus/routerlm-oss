import { z } from 'zod';
import type {
  AssistantContentPart,
  FunctionTool,
  InferenceMessage,
  InferenceRequest,
  InferenceResponse,
  InferenceStreamEvent,
  ReasoningPart,
  ResponseFormat,
  StopReason,
  TokenUsage,
  ToolChoice,
  UserContentPart,
} from '@/inference/models/internal-format';
import { isJsonObject } from '@/inference/protocols/json-object';
import type { ServerSentEvent } from '@/inference/protocols/server-sent-events';
import {
  type UpstreamHttpRequest,
  UpstreamProtocolError,
  type UpstreamProtocolConverter,
  type UpstreamStreamParser,
  type UpstreamTarget,
} from '@/inference/protocols/upstream-protocol-converter';

const RESPONSES_PATH = '/responses';
const ENCRYPTED_REASONING = 'reasoning.encrypted_content';
const DEFAULT_TOOL_STRICTNESS = false;
const PART_SEPARATOR = '\n\n';

function writeRequest(request: InferenceRequest, target: UpstreamTarget): UpstreamHttpRequest {
  const { quirks } = target;
  const dropped = new Set(quirks.droppedParameters ?? []);
  const systemAsInput = quirks.systemAsDeveloperMessage === true && request.system.length > 0;
  const body: Record<string, unknown> = { model: target.upstreamModelId };
  if (request.system.length > 0 && !systemAsInput) {
    body.instructions = request.system.map((part) => part.text).join(PART_SEPARATOR);
  }
  body.input = [
    ...(systemAsInput ? [writeDeveloperMessage(request)] : []),
    ...request.messages.flatMap(writeInputItems),
  ];
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
    body.text = { format: writeResponseFormat(request.responseFormat) };
  }
  if (request.reasoning?.effort) {
    body.reasoning = { effort: request.reasoning.effort };
  }
  if (request.maxOutputTokens !== undefined && !dropped.has('max_output_tokens')) {
    body.max_output_tokens = request.maxOutputTokens;
  }
  if (request.temperature !== undefined && !dropped.has('temperature')) {
    body.temperature = request.temperature;
  }
  if (request.topP !== undefined && !dropped.has('top_p')) {
    body.top_p = request.topP;
  }
  if (quirks.includesEncryptedReasoning) {
    body.include = [ENCRYPTED_REASONING];
  }
  if (quirks.acceptsPromptCacheKey && target.promptCacheKey !== undefined) {
    body.prompt_cache_key = target.promptCacheKey;
  } else if (quirks.forwardsClientPromptCacheKey && request.promptCacheKey !== undefined) {
    body.prompt_cache_key = request.promptCacheKey;
  }
  if (target.serviceTierValue !== undefined) {
    body.service_tier = target.serviceTierValue;
  }
  body.store = false;
  const isAnsweredAsStream = request.stream === null && quirks.alwaysStreams === true;
  if (request.stream !== null || isAnsweredAsStream) {
    body.stream = true;
  }
  return {
    url: `${target.baseUrl.replace(/\/+$/, '')}${RESPONSES_PATH}`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(isAnsweredAsStream && { isAnsweredAsStream }),
  };
}

function writeDeveloperMessage(request: InferenceRequest): Record<string, unknown> {
  return {
    type: 'message',
    role: 'developer',
    content: request.system.map((part) => ({ type: 'input_text', text: part.text })),
  };
}

function writeInputItems(message: InferenceMessage): Record<string, unknown>[] {
  switch (message.role) {
    case 'user':
      return [{ type: 'message', role: 'user', content: message.content.map(writeUserPart) }];
    case 'tool':
      return [
        {
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: writeToolOutput(message.content),
        },
      ];
    case 'assistant':
      return writeAssistantItems(message.content);
  }
}

function writeUserPart(part: UserContentPart): Record<string, unknown> {
  if (part.type === 'text') {
    return { type: 'input_text', text: part.text };
  }
  const imageUrl =
    part.source.type === 'url'
      ? part.source.url
      : `data:${part.source.mediaType};base64,${part.source.data}`;
  return { type: 'input_image', image_url: imageUrl };
}

function writeToolOutput(content: UserContentPart[]): string | Record<string, unknown>[] {
  const [first] = content;
  if (content.length === 1 && first.type === 'text') {
    return first.text;
  }
  return content.map(writeUserPart);
}

function writeAssistantItems(content: AssistantContentPart[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  let openText: { type: 'output_text'; text: string }[] | null = null;
  for (const part of content) {
    if (part.type === 'text') {
      if (openText === null) {
        openText = [];
        items.push({ type: 'message', role: 'assistant', content: openText });
      }
      openText.push({ type: 'output_text', text: part.text });
      continue;
    }
    openText = null;
    if (part.type === 'tool-call') {
      items.push({
        type: 'function_call',
        call_id: part.id,
        name: part.name,
        arguments: part.arguments,
      });
    } else if (part.signature !== undefined) {
      items.push(writeReasoningItem(part));
    }
  }
  return items;
}

function writeReasoningItem(part: ReasoningPart): Record<string, unknown> {
  return {
    type: 'reasoning',
    summary: part.text === '' ? [] : [{ type: 'summary_text', text: part.text }],
    encrypted_content: part.signature,
  };
}

function writeTool(tool: FunctionTool): Record<string, unknown> {
  const definition: Record<string, unknown> = { type: 'function', name: tool.name };
  if (tool.description !== undefined) {
    definition.description = tool.description;
  }
  definition.parameters = tool.parameters;
  definition.strict = tool.strict ?? DEFAULT_TOOL_STRICTNESS;
  return definition;
}

function writeToolChoice(choice: ToolChoice): unknown {
  return choice.type === 'tool' ? { type: 'function', name: choice.name } : choice.type;
}

function writeResponseFormat(format: ResponseFormat): Record<string, unknown> {
  switch (format.type) {
    case 'text':
      return { type: 'text' };
    case 'json-object':
      return { type: 'json_object' };
    case 'json-schema': {
      const written: Record<string, unknown> = {
        type: 'json_schema',
        name: format.name,
        schema: format.schema,
      };
      if (format.strict !== undefined) {
        written.strict = format.strict;
      }
      return written;
    }
  }
}

const reasoningTextSchema = z.object({ text: z.string() });

const outputItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    content: z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('output_text'), text: z.string() }),
        z.object({ type: z.literal('refusal'), refusal: z.string() }),
      ]),
    ),
  }),
  z.object({
    type: z.literal('reasoning'),
    summary: z.array(reasoningTextSchema).nullish(),
    content: z.array(reasoningTextSchema).nullish(),
    encrypted_content: z.string().nullish(),
  }),
  z.object({
    type: z.literal('function_call'),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
]);
type OutputItem = z.infer<typeof outputItemSchema>;

const lenientOutputSchema = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = outputItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);

const usageSchema = z.object({
  input_tokens: z.number().nullish(),
  input_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish(),
  output_tokens: z.number().nullish(),
  output_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
});
type ResponsesUsage = z.infer<typeof usageSchema>;

const responseSchema = z.object({
  status: z.string().nullish(),
  incomplete_details: z.object({ reason: z.string().nullish() }).nullish(),
  output: lenientOutputSchema,
  usage: usageSchema.nullish(),
  service_tier: z.string().nullish(),
});
type UpstreamResponse = z.infer<typeof responseSchema>;

function parseResponse(body: unknown): InferenceResponse {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamProtocolError(`Not a response: ${parsed.error.message}`);
  }
  return {
    content: parsed.data.output.flatMap(contentOfItem),
    stopReason: stopReasonOf(
      parsed.data,
      parsed.data.output.some((item) => item.type === 'function_call'),
    ),
    usage: tokenUsageOf(parsed.data.usage ?? undefined),
    ...(parsed.data.service_tier && { servedTierValue: parsed.data.service_tier }),
  };
}

function contentOfItem(item: OutputItem): AssistantContentPart[] {
  switch (item.type) {
    case 'message':
      return item.content.map((part) => ({
        type: 'text',
        text: part.type === 'refusal' ? part.refusal : part.text,
      }));
    case 'reasoning':
      return [
        {
          type: 'reasoning',
          text: reasoningTextOf(item),
          ...(item.encrypted_content && { signature: item.encrypted_content }),
        },
      ];
    case 'function_call':
      return [{ type: 'tool-call', id: item.call_id, name: item.name, arguments: item.arguments }];
  }
}

function reasoningTextOf(item: Extract<OutputItem, { type: 'reasoning' }>): string {
  const texts = item.content?.length ? item.content : (item.summary ?? []);
  return texts.map((text) => text.text).join(PART_SEPARATOR);
}

const INCOMPLETE_STOP_REASONS = new Map<string, StopReason>([
  ['max_output_tokens', 'max-tokens'],
  ['content_filter', 'content-filter'],
]);

function stopReasonOf(response: UpstreamResponse, hasToolCalls: boolean): StopReason {
  const incompleteReason = response.incomplete_details?.reason;
  if (response.status === 'incomplete' && incompleteReason) {
    return INCOMPLETE_STOP_REASONS.get(incompleteReason) ?? 'other';
  }
  return hasToolCalls ? 'tool-calls' : 'end';
}

function tokenUsageOf(usage: ResponsesUsage | undefined): TokenUsage {
  const inputTokens = usage?.input_tokens ?? null;
  const cacheReadTokens = usage?.input_tokens_details?.cached_tokens ?? null;
  return {
    inputTokens: inputTokens === null ? null : inputTokens - (cacheReadTokens ?? 0),
    outputTokens: usage?.output_tokens ?? null,
    cacheReadTokens,
    cacheWriteTokens: usage === undefined ? null : 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
  };
}

const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('response.output_text.delta'), delta: z.string() }),
  z.object({ type: z.literal('response.refusal.delta'), delta: z.string() }),
  z.object({ type: z.literal('response.reasoning_text.delta'), delta: z.string() }),
  z.object({ type: z.literal('response.reasoning_summary_text.delta'), delta: z.string() }),
  z.object({
    type: z.literal('response.reasoning_summary_part.added'),
    summary_index: z.number(),
  }),
  z.object({
    type: z.literal('response.output_item.added'),
    output_index: z.number(),
    item: z.object({ type: z.string() }).loose(),
  }),
  z.object({
    type: z.literal('response.function_call_arguments.delta'),
    output_index: z.number(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('response.output_item.done'),
    output_index: z.number(),
    item: z.object({ type: z.string() }).loose(),
  }),
  z.object({
    type: z.enum(['response.completed', 'response.incomplete']),
    response: responseSchema,
  }),
  z.object({ type: z.enum(['response.failed', 'error']) }).loose(),
]);
type StreamEvent = z.infer<typeof streamEventSchema>;

const typedEventSchema = z.object({ type: z.string() });

const READ_EVENT_TYPES: ReadonlySet<string> = new Set<StreamEvent['type']>([
  'response.output_text.delta',
  'response.refusal.delta',
  'response.reasoning_text.delta',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_part.added',
  'response.output_item.added',
  'response.function_call_arguments.delta',
  'response.output_item.done',
  'response.completed',
  'response.incomplete',
  'response.failed',
  'error',
]);

class ResponsesStreamParser implements UpstreamStreamParser {
  readonly isDone = false;
  private readonly reader = new ResponseStreamReader();

  parse({ data }: ServerSentEvent): InferenceStreamEvent[] {
    const json = parseJson(data);
    const tokenEvents = eventsOfTokenDelta(json);
    if (tokenEvents) {
      return tokenEvents;
    }
    const typed = typedEventSchema.safeParse(json);
    if (!typed.success) {
      throw new UpstreamProtocolError(`Not a response stream event: ${typed.error.message}`);
    }
    if (!READ_EVENT_TYPES.has(typed.data.type)) {
      return [];
    }
    const event = streamEventSchema.safeParse(json);
    if (!event.success) {
      throw new UpstreamProtocolError(`Not a response stream event: ${event.error.message}`);
    }
    return [...this.reader.read(event.data)];
  }

  end(): InferenceStreamEvent[] {
    return [];
  }
}

function startStream(): UpstreamStreamParser {
  return new ResponsesStreamParser();
}

const TOKEN_DELTA_TYPES: ReadonlyMap<string, 'text-delta' | 'reasoning-delta'> = new Map([
  ['response.output_text.delta', 'text-delta'],
  ['response.refusal.delta', 'text-delta'],
  ['response.reasoning_text.delta', 'reasoning-delta'],
  ['response.reasoning_summary_text.delta', 'reasoning-delta'],
]);

function eventsOfTokenDelta(json: unknown): InferenceStreamEvent[] | undefined {
  if (!isJsonObject(json) || typeof json.type !== 'string' || typeof json.delta !== 'string') {
    return undefined;
  }
  const deltaType = TOKEN_DELTA_TYPES.get(json.type);
  if (!deltaType) {
    return undefined;
  }
  return [{ type: deltaType, text: json.delta }];
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new UpstreamProtocolError('A stream event is not JSON', { cause: error });
  }
}

const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string().nullish(),
});
const reasoningItemSchema = z.object({
  type: z.literal('reasoning'),
  encrypted_content: z.string().nullish(),
});

class ResponseStreamReader {
  private readonly toolIndexes = new Map<number, number>();
  private readonly toolsWithDeltas = new Set<number>();

  *read(event: StreamEvent): Iterable<InferenceStreamEvent> {
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        yield { type: 'text-delta', text: event.delta };
        return;
      case 'response.reasoning_text.delta':
      case 'response.reasoning_summary_text.delta':
        yield { type: 'reasoning-delta', text: event.delta };
        return;
      case 'response.reasoning_summary_part.added':
        if (event.summary_index > 0) {
          yield { type: 'reasoning-delta', text: PART_SEPARATOR };
        }
        return;
      case 'response.output_item.added':
        yield* this.itemAdded(event.output_index, event.item);
        return;
      case 'response.function_call_arguments.delta':
        yield* this.argumentsDelta(event.output_index, event.delta);
        return;
      case 'response.output_item.done':
        yield* this.itemDone(event.output_index, event.item);
        return;
      case 'response.completed':
      case 'response.incomplete':
        yield {
          type: 'finish',
          stopReason: stopReasonOf(event.response, this.toolIndexes.size > 0),
        };
        yield {
          type: 'usage',
          usage: tokenUsageOf(event.response.usage ?? undefined),
          ...(event.response.service_tier && { servedTierValue: event.response.service_tier }),
        };
        return;
      case 'response.failed':
      case 'error':
        throw new UpstreamProtocolError(
          `The upstream reported an error mid-stream: ${JSON.stringify(event)}`,
        );
    }
  }

  private *itemAdded(outputIndex: number, item: unknown): Iterable<InferenceStreamEvent> {
    const call = functionCallItemSchema.safeParse(item);
    if (!call.success) {
      return;
    }
    const index = this.toolIndexes.size;
    this.toolIndexes.set(outputIndex, index);
    yield { type: 'tool-call-start', index, id: call.data.call_id, name: call.data.name };
  }

  private *argumentsDelta(outputIndex: number, delta: string): Iterable<InferenceStreamEvent> {
    const index = this.toolIndexes.get(outputIndex);
    if (index === undefined) {
      throw new UpstreamProtocolError('Tool call arguments arrived for no started tool call');
    }
    this.toolsWithDeltas.add(outputIndex);
    yield { type: 'tool-call-delta', index, argumentsDelta: delta };
  }

  private *itemDone(outputIndex: number, item: unknown): Iterable<InferenceStreamEvent> {
    const reasoning = reasoningItemSchema.safeParse(item);
    if (reasoning.success && reasoning.data.encrypted_content) {
      yield { type: 'reasoning-signature', signature: reasoning.data.encrypted_content };
      return;
    }
    const call = functionCallItemSchema.safeParse(item);
    const index = this.toolIndexes.get(outputIndex);
    if (
      call.success &&
      call.data.arguments &&
      index !== undefined &&
      !this.toolsWithDeltas.has(outputIndex)
    ) {
      yield { type: 'tool-call-delta', index, argumentsDelta: call.data.arguments };
    }
  }
}

export const openAiResponsesUpstreamConverter: UpstreamProtocolConverter = {
  protocol: 'openai-responses',
  writeRequest,
  parseResponse,
  startStream,
};
