export interface CacheMarker {
  ttl?: '5m' | '1h';
}

export interface TextPart {
  type: 'text';
  text: string;
  cacheMarker?: CacheMarker;
}

export interface ImagePart {
  type: 'image';
  source: { type: 'url'; url: string } | { type: 'base64'; mediaType: string; data: string };
  cacheMarker?: CacheMarker;
}

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
  signature?: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  id: string;
  name: string;
  arguments: string;
}

export type UserContentPart = TextPart | ImagePart;
export type AssistantContentPart = TextPart | ReasoningPart | ToolCallPart;

export type InferenceMessage =
  | { role: 'user'; content: UserContentPart[] }
  | { role: 'assistant'; content: AssistantContentPart[] }
  | { role: 'tool'; toolCallId: string; content: UserContentPart[] };

export interface FunctionTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
  cacheMarker?: CacheMarker;
}

export type ToolChoice =
  | { type: 'auto' }
  | { type: 'none' }
  | { type: 'required' }
  | { type: 'tool'; name: string };

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json-object' }
  | { type: 'json-schema'; name: string; schema: Record<string, unknown>; strict?: boolean };

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const SERVICE_TIERS = ['fast', 'flex'] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export interface InferenceRequest {
  model: string;
  system: TextPart[];
  messages: InferenceMessage[];
  tools: FunctionTool[];
  toolChoice?: ToolChoice;
  parallelToolCalls?: boolean;
  responseFormat?: ResponseFormat;
  reasoning?: { effort?: ReasoningEffort; budgetTokens?: number };
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  serviceTier?: ServiceTier;
  promptCacheKey?: string;
  stream: { includeUsage: boolean } | null;
}

export type StopReason =
  | 'end'
  | 'max-tokens'
  | 'tool-calls'
  | 'stop-sequence'
  | 'content-filter'
  | 'other';

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
}

export interface InferenceResponse {
  content: AssistantContentPart[];
  stopReason: StopReason;
  usage: TokenUsage;
  servedTierValue?: string;
}

export type InferenceStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-signature'; signature: string }
  | { type: 'tool-call-start'; index: number; id: string; name: string }
  | { type: 'tool-call-delta'; index: number; argumentsDelta: string }
  | { type: 'finish'; stopReason: StopReason }
  | { type: 'usage'; usage: TokenUsage; servedTierValue?: string };

export const UNREPORTED_USAGE: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
};
