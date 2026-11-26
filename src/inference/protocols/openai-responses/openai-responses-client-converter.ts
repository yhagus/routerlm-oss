import { z } from 'zod';
import { GatewayError } from '@/inference/models/gateway-error';
import { serviceTierOfOpenAiClient } from '@/inference/models/service-tier';
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
} from '@/inference/models/internal-format';
import {
  type ClientProtocolConverter,
  type ClientStreamWriter,
  type ResponseContext,
} from '@/inference/protocols/client-protocol-converter';
import { openAiChatClientConverter } from '@/inference/protocols/openai-chat/openai-chat-client-converter';

const inputTextSchema = z.object({ type: z.literal('input_text'), text: z.string() });
const inputImageSchema = z.object({
  type: z.literal('input_image'),
  image_url: z.string().min(1),
});
const outputTextSchema = z.object({ type: z.literal('output_text'), text: z.string() });
const refusalSchema = z.object({ type: z.literal('refusal'), refusal: z.string() });

const userContentSchema = z.union([
  z.string(),
  z.array(z.discriminatedUnion('type', [inputTextSchema, inputImageSchema])),
]);
const instructionContentSchema = z.union([z.string(), z.array(inputTextSchema)]);
const assistantContentSchema = z.union([
  z.string(),
  z.array(z.discriminatedUnion('type', [outputTextSchema, inputTextSchema, refusalSchema])),
]);

const messageItemSchema = z.discriminatedUnion('role', [
  z.object({
    type: z.literal('message').optional(),
    role: z.literal('user'),
    content: userContentSchema,
  }),
  z.object({
    type: z.literal('message').optional(),
    role: z.enum(['system', 'developer']),
    content: instructionContentSchema,
  }),
  z.object({
    type: z.literal('message').optional(),
    role: z.literal('assistant'),
    content: assistantContentSchema,
  }),
]);

const reasoningTextSchema = z.object({ text: z.string() });
const reasoningItemSchema = z.object({
  type: z.literal('reasoning'),
  summary: z.array(reasoningTextSchema).optional(),
  content: z.array(reasoningTextSchema).nullish(),
  encrypted_content: z.string().nullish(),
});
const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
});
const functionCallOutputItemSchema = z.object({
  type: z.literal('function_call_output'),
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

const CLIENT_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type ClientEffort = (typeof CLIENT_EFFORTS)[number];

const CLIENT_EFFORT_LEVELS = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'xhigh',
} as const satisfies Record<ClientEffort, ReasoningEffort>;

const requestSchema = z.object({
  model: z.string().min(1),
  instructions: z.string().nullish(),
  input: z.union([z.string(), z.array(inputItemSchema).min(1)]),
  tools: z
    .array(
      z.object({
        type: z.literal('function'),
        name: z.string().min(1),
        description: z.string().nullish(),
        parameters: z.record(z.string(), z.unknown()).nullish(),
        strict: z.boolean().nullish(),
      }),
    )
    .optional(),
  tool_choice: z
    .union([
      z.enum(['auto', 'none', 'required']),
      z.object({ type: z.literal('function'), name: z.string().min(1) }),
    ])
    .optional(),
  parallel_tool_calls: z.boolean().nullish(),
  text: z
    .object({
      format: z
        .discriminatedUnion('type', [
          z.object({ type: z.literal('text') }),
          z.object({ type: z.literal('json_object') }),
          z.object({
            type: z.literal('json_schema'),
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
  prompt_cache_key: z.string().min(1).nullish(),
  service_tier: z.string().nullish(),
  stream: z.boolean().nullish(),
});
type ClientRequest = z.infer<typeof requestSchema>;

const EMPTY_PARAMETERS_SCHEMA = { type: 'object', properties: {} };
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

function parseRequest(body: unknown): InferenceRequest {
  refuseOutOfScopeFeatures(body);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(
      'invalid_request',
      `Invalid request: ${z.prettifyError(parsed.error)}`,
      'client',
    );
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
  'message',
  'reasoning',
  'function_call',
  'function_call_output',
]);
const SUPPORTED_CONTENT_PARTS = new Set(['input_text', 'input_image', 'output_text', 'refusal']);
const SEND_THE_CONVERSATION = 'the gateway is stateless, so send the whole conversation in `input`';

function refuseOutOfScopeFeatures(body: unknown): void {
  const features = featureRefusedSchema.safeParse(body);
  if (!features.success) {
    return;
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
    throw unsupported('background mode (`background`)');
  }
  if (prompt != null) {
    throw unsupported('stored prompts (`prompt`)');
  }
  const otherTool = tools?.find((tool) => tool.type !== 'function');
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
  if (!SUPPORTED_INPUT_ITEMS.has(typeof item.type === 'string' ? item.type : undefined)) {
    throw unsupported(`input items of type \`${String(item.type)}\``);
  }
  if (item.type === 'reasoning') {
    return;
  }
  const parts = z
    .array(typedSchema)
    .safeParse(item.type === 'function_call_output' ? item.output : item.content);
  for (const part of parts.success ? parts.data : []) {
    if (typeof part.type === 'string' && !SUPPORTED_CONTENT_PARTS.has(part.type)) {
      throw unsupported(`content parts of type \`${part.type}\``);
    }
    if (part.type === 'input_image' && part.image_url == null) {
      throw unsupported('images by `file_id`; send an `image_url` (a URL or a data URL)');
    }
  }
}

function unsupported(feature: string): GatewayError {
  return new GatewayError('invalid_request', `Not supported: ${feature}`, 'client');
}

function toInferenceRequest(request: ClientRequest): InferenceRequest {
  const system: TextPart[] = [];
  if (request.instructions) {
    system.push({ type: 'text', text: request.instructions });
  }
  const items: InputItem[] =
    typeof request.input === 'string' ? [{ role: 'user', content: request.input }] : request.input;
  const messages: InferenceMessage[] = [];
  for (const item of items) {
    if (isInstruction(item)) {
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
  if (request.prompt_cache_key != null) {
    parsed.promptCacheKey = request.prompt_cache_key;
  }
  const serviceTier = serviceTierOfOpenAiClient(request.service_tier);
  if (serviceTier) {
    parsed.serviceTier = serviceTier;
  }
  return parsed;
}

type InstructionItem = Extract<InputItem, { role: 'system' | 'developer' }>;
type ConversationItem = Exclude<InputItem, InstructionItem>;

function isInstruction(item: InputItem): item is InstructionItem {
  return 'role' in item && (item.role === 'system' || item.role === 'developer');
}

function appendItem(messages: InferenceMessage[], item: ConversationItem): void {
  if ('role' in item && item.role === 'user') {
    messages.push({ role: 'user', content: userContent(item.content) });
    return;
  }
  if (item.type === 'function_call_output') {
    messages.push({ role: 'tool', toolCallId: item.call_id, content: userContent(item.output) });
    return;
  }
  const last = messages.at(-1);
  const assistant = last?.role === 'assistant' ? last : { role: 'assistant' as const, content: [] };
  if (assistant !== last) {
    messages.push(assistant);
  }
  assistant.content.push(...assistantParts(item));
}

function assistantParts(
  item: Exclude<ConversationItem, { role: 'user' } | { type: 'function_call_output' }>,
): AssistantContentPart[] {
  if ('role' in item) {
    if (typeof item.content === 'string') {
      return [{ type: 'text', text: item.content }];
    }
    return item.content.map((part) => ({
      type: 'text',
      text: part.type === 'refusal' ? part.refusal : part.text,
    }));
  }
  if (item.type === 'function_call') {
    return [{ type: 'tool-call', id: item.call_id, name: item.name, arguments: item.arguments }];
  }
  const texts = item.content?.length ? item.content : (item.summary ?? []);
  return [
    {
      type: 'reasoning',
      text: texts.map((text) => text.text).join('\n\n'),
      ...(item.encrypted_content && { signature: item.encrypted_content }),
    },
  ];
}

function textParts(content: z.infer<typeof instructionContentSchema>): TextPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content.map((part) => ({ type: 'text', text: part.text }));
}

function userContent(content: z.infer<typeof userContentSchema>): UserContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content.map((part): UserContentPart => {
    if (part.type === 'input_text') {
      return { type: 'text', text: part.text };
    }
    const dataUrl = DATA_URL.exec(part.image_url);
    if (dataUrl) {
      return { type: 'image', source: { type: 'base64', mediaType: dataUrl[1], data: dataUrl[2] } };
    }
    return { type: 'image', source: { type: 'url', url: part.image_url } };
  });
}

function toToolChoice(choice: NonNullable<ClientRequest['tool_choice']>): ToolChoice {
  return typeof choice === 'string' ? { type: choice } : { type: 'tool', name: choice.name };
}

function toResponseFormat(
  format: NonNullable<NonNullable<ClientRequest['text']>['format']>,
): ResponseFormat {
  switch (format.type) {
    case 'text':
      return { type: 'text' };
    case 'json_object':
      return { type: 'json-object' };
    case 'json_schema':
      return {
        type: 'json-schema',
        name: format.name,
        schema: format.schema,
        ...(format.strict != null && { strict: format.strict }),
      };
  }
}

const RESPONSE_ID_PREFIX = 'resp_';
const ITEM_ID_PREFIXES = { message: 'msg_', reasoning: 'rs_', function_call: 'fc_' } as const;
type OutputItemType = keyof typeof ITEM_ID_PREFIXES;
type ItemStatus = 'in_progress' | 'completed';

const INCOMPLETE_REASONS: Partial<Record<StopReason, string>> = {
  'max-tokens': 'max_output_tokens',
  'content-filter': 'content_filter',
};

type ResponseEnding = { stopReason: StopReason; usage: TokenUsage } | null;

function writeResponse(
  response: InferenceResponse,
  request: InferenceRequest,
  context: ResponseContext,
): unknown {
  const output = mergeTextParts(response.content).map((part, outputIndex) => {
    const id = outputItemId(context, outputItemTypeOf(part), outputIndex);
    switch (part.type) {
      case 'text':
        return messageItem(id, 'completed', part.text);
      case 'reasoning':
        return reasoningItem(id, 'completed', part);
      case 'tool-call':
        return functionCallItem(id, 'completed', part);
    }
  });
  return responseObject(request, context, output, response);
}

function mergeTextParts(content: AssistantContentPart[]): AssistantContentPart[] {
  const merged: AssistantContentPart[] = [];
  for (const part of content) {
    const previous = merged.at(-1);
    if (part.type === 'text' && previous?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', text: previous.text + part.text };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function outputItemTypeOf(part: AssistantContentPart): OutputItemType {
  switch (part.type) {
    case 'text':
      return 'message';
    case 'reasoning':
      return 'reasoning';
    case 'tool-call':
      return 'function_call';
  }
}

function outputItemId(context: ResponseContext, type: OutputItemType, outputIndex: number): string {
  return `${ITEM_ID_PREFIXES[type]}${context.requestId}_${outputIndex}`;
}

function messageItem(id: string, status: ItemStatus, text: string | null): Record<string, unknown> {
  return {
    id,
    type: 'message',
    status,
    role: 'assistant',
    content: text === null ? [] : [outputTextPart(text)],
  };
}

function outputTextPart(text: string): Record<string, unknown> {
  return { type: 'output_text', text, annotations: [], logprobs: [] };
}

function reasoningItem(
  id: string,
  status: ItemStatus,
  reasoning: Omit<ReasoningPart, 'type'> | null,
): Record<string, unknown> {
  return {
    id,
    type: 'reasoning',
    status,
    summary: [],
    content: reasoning === null ? [] : [reasoningTextPart(reasoning.text)],
    ...(reasoning?.signature && { encrypted_content: reasoning.signature }),
  };
}

function reasoningTextPart(text: string): Record<string, unknown> {
  return { type: 'reasoning_text', text };
}

function functionCallItem(
  id: string,
  status: ItemStatus,
  call: Omit<ToolCallPart, 'type'>,
): Record<string, unknown> {
  return {
    id,
    type: 'function_call',
    status,
    call_id: call.id,
    name: call.name,
    arguments: call.arguments,
  };
}

function responseObject(
  request: InferenceRequest,
  context: ResponseContext,
  output: unknown[],
  ending: ResponseEnding,
): Record<string, unknown> {
  const incompleteReason = ending && INCOMPLETE_REASONS[ending.stopReason];
  return {
    id: `${RESPONSE_ID_PREFIX}${context.requestId}`,
    object: 'response',
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
      type: 'function',
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
    truncation: 'disabled',
    usage: ending === null ? null : writeUsage(ending.usage),
  };
}

function responseStatusOf(ending: ResponseEnding): 'in_progress' | 'completed' | 'incomplete' {
  if (ending === null) {
    return 'in_progress';
  }
  return INCOMPLETE_REASONS[ending.stopReason] === undefined ? 'completed' : 'incomplete';
}

function writeToolChoice(choice: ToolChoice | undefined): unknown {
  if (choice === undefined) {
    return 'auto';
  }
  return choice.type === 'tool' ? { type: 'function', name: choice.name } : choice.type;
}

function writeResponseFormat(format: ResponseFormat | undefined): Record<string, unknown> {
  switch (format?.type) {
    case undefined:
    case 'text':
      return { type: 'text' };
    case 'json-object':
      return { type: 'json_object' };
    case 'json-schema':
      return {
        type: 'json_schema',
        name: format.name,
        schema: format.schema,
        strict: format.strict ?? null,
      };
  }
}

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

function startStream(request: InferenceRequest, context: ResponseContext): ClientStreamWriter {
  return new OpenAiResponsesStreamWriter(request, context);
}

class OpenAiResponsesStreamWriter implements ClientStreamWriter {
  private readonly items: ResponseEventWriter;
  private stopReason: StopReason = 'end';
  private usage = UNREPORTED_USAGE;

  constructor(request: InferenceRequest, context: ResponseContext) {
    this.items = new ResponseEventWriter(request, context);
  }

  start(): string {
    const created = this.items.lifecycleEvent('response.created', null);
    return created + this.items.lifecycleEvent('response.in_progress', null);
  }

  write(event: InferenceStreamEvent): string {
    switch (event.type) {
      case 'finish':
        this.stopReason = event.stopReason;
        return '';
      case 'usage':
        this.usage = event.usage;
        return '';
      default:
        return this.items.write(event);
    }
  }

  end(): string {
    const closing = this.items.closeOpenItem();
    const ending = { stopReason: this.stopReason, usage: this.usage };
    const lifecycleType =
      responseStatusOf(ending) === 'completed' ? 'response.completed' : 'response.incomplete';
    return closing + this.items.lifecycleEvent(lifecycleType, ending);
  }
}

type ContentEvent = Exclude<InferenceStreamEvent, { type: 'finish' | 'usage' }>;

interface OpenItemPosition {
  id: string;
  outputIndex: number;
}
type OpenMessage = OpenItemPosition & { type: 'message'; text: string };
type OpenReasoning = OpenItemPosition & { type: 'reasoning'; text: string; signature?: string };
type OpenFunctionCall = OpenItemPosition & {
  type: 'function_call';
  toolIndex: number;
  call: Omit<ToolCallPart, 'type'>;
};
type OpenItem = OpenMessage | OpenReasoning | OpenFunctionCall;

interface Opened<Item> {
  written: string;
  item: Item;
}

const CONTENT_INDEX = 0;

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

  write(event: ContentEvent): string {
    switch (event.type) {
      case 'text-delta': {
        const { written, item: message } = this.openMessage();
        message.text += event.text;
        return (
          written +
          this.event('response.output_text.delta', {
            ...this.contentPosition(message),
            delta: event.text,
            logprobs: [],
          })
        );
      }
      case 'reasoning-delta': {
        const { written, item: reasoning } = this.unsignedReasoning();
        reasoning.text += event.text;
        return (
          written +
          this.event('response.reasoning_text.delta', {
            ...this.contentPosition(reasoning),
            delta: event.text,
          })
        );
      }
      case 'reasoning-signature': {
        const { written, item: reasoning } = this.unsignedReasoning();
        reasoning.signature = event.signature;
        return written;
      }
      case 'tool-call-start':
        return this.startFunctionCall(event.index, { id: event.id, name: event.name });
      case 'tool-call-delta': {
        const call = this.open;
        if (call?.type !== 'function_call' || call.toolIndex !== event.index) {
          throw new GatewayError(
            'upstream_error',
            'The upstream interleaved tool call arguments',
            'upstream',
          );
        }
        call.call.arguments += event.argumentsDelta;
        return this.event('response.function_call_arguments.delta', {
          item_id: call.id,
          output_index: call.outputIndex,
          delta: event.argumentsDelta,
        });
      }
    }
  }

  closeOpenItem(): string {
    const item = this.open;
    if (item === null) {
      return '';
    }
    this.open = null;
    let written: string;
    let done: Record<string, unknown>;
    switch (item.type) {
      case 'message': {
        const part = outputTextPart(item.text);
        written =
          this.event('response.output_text.done', {
            ...this.contentPosition(item),
            text: item.text,
            logprobs: [],
          }) + this.event('response.content_part.done', { ...this.contentPosition(item), part });
        done = messageItem(item.id, 'completed', item.text);
        break;
      }
      case 'reasoning': {
        written =
          this.event('response.reasoning_text.done', {
            ...this.contentPosition(item),
            text: item.text,
          }) +
          this.event('response.content_part.done', {
            ...this.contentPosition(item),
            part: reasoningTextPart(item.text),
          });
        done = reasoningItem(item.id, 'completed', item);
        break;
      }
      case 'function_call':
        written = this.event('response.function_call_arguments.done', {
          item_id: item.id,
          output_index: item.outputIndex,
          arguments: item.call.arguments,
        });
        done = functionCallItem(item.id, 'completed', item.call);
        break;
    }
    this.finishedItems.push(done);
    return (
      written +
      this.event('response.output_item.done', { output_index: item.outputIndex, item: done })
    );
  }

  private openMessage(): Opened<OpenMessage> {
    if (this.open?.type === 'message') {
      return { written: '', item: this.open };
    }
    const closing = this.closeOpenItem();
    const message: OpenMessage = { ...this.nextPosition('message'), type: 'message', text: '' };
    this.open = message;
    const written =
      closing +
      this.itemAdded(message, messageItem(message.id, 'in_progress', null)) +
      this.event('response.content_part.added', {
        ...this.contentPosition(message),
        part: outputTextPart(''),
      });
    return { written, item: message };
  }

  private unsignedReasoning(): Opened<OpenReasoning> {
    if (this.open?.type === 'reasoning' && this.open.signature === undefined) {
      return { written: '', item: this.open };
    }
    const closing = this.closeOpenItem();
    const reasoning: OpenReasoning = {
      ...this.nextPosition('reasoning'),
      type: 'reasoning',
      text: '',
    };
    this.open = reasoning;
    const written =
      closing +
      this.itemAdded(reasoning, reasoningItem(reasoning.id, 'in_progress', null)) +
      this.event('response.content_part.added', {
        ...this.contentPosition(reasoning),
        part: reasoningTextPart(''),
      });
    return { written, item: reasoning };
  }

  private startFunctionCall(
    toolIndex: number,
    call: Omit<ToolCallPart, 'type' | 'arguments'>,
  ): string {
    const closing = this.closeOpenItem();
    const functionCall: OpenFunctionCall = {
      ...this.nextPosition('function_call'),
      type: 'function_call',
      toolIndex,
      call: { ...call, arguments: '' },
    };
    this.open = functionCall;
    return (
      closing +
      this.itemAdded(
        functionCall,
        functionCallItem(functionCall.id, 'in_progress', functionCall.call),
      )
    );
  }

  private nextPosition(type: OutputItemType): OpenItemPosition {
    const outputIndex = this.finishedItems.length;
    return { id: outputItemId(this.context, type, outputIndex), outputIndex };
  }

  private itemAdded(position: OpenItemPosition, item: Record<string, unknown>): string {
    return this.event('response.output_item.added', { output_index: position.outputIndex, item });
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

function writeError(error: GatewayError): unknown {
  return openAiChatClientConverter.writeError(error);
}

function writeStreamError(error: GatewayError): string {
  return namedEvent('error', {
    type: 'error',
    code: error.code,
    message: error.message,
    param: null,
  });
}

export const openAiResponsesClientConverter: ClientProtocolConverter = {
  protocol: 'openai-responses',
  parseRequest,
  writeResponse,
  startStream,
  writeError,
  writeStreamError,
};
