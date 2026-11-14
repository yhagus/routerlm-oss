// The internal request, response and stream-event format (ADR 0002). Every
// client Protocol is parsed into it and every upstream Protocol is written from
// it, so it only holds what survives translation in any direction: text, image
// input, function tools, reasoning and structured output. Parameter Policy keys
// are the field names of InferenceRequest.

/**
 * A prompt-cache breakpoint the client set: the upstream may cache the prompt
 * up to and including the part that carries it.
 */
export interface CacheMarker {
  ttl?: "5m" | "1h";
}

export interface TextPart {
  type: "text";
  text: string;
  cacheMarker?: CacheMarker;
}

/** An image the client sent inline (base64) or by URL. */
export interface ImagePart {
  type: "image";
  source: { type: "url"; url: string } | { type: "base64"; mediaType: string; data: string };
  cacheMarker?: CacheMarker;
}

/**
 * The model's thinking. `signature` is the opaque proof some Protocols
 * (anthropic-messages) need to accept it back in a later turn.
 */
export interface ReasoningPart {
  type: "reasoning";
  text: string;
  signature?: string;
}

export interface ToolCallPart {
  type: "tool-call";
  /** Kept as the upstream issued it: clients send it back with the tool's result. */
  id: string;
  name: string;
  /** JSON text, exactly as the model produced it. */
  arguments: string;
}

export type UserContentPart = TextPart | ImagePart;
export type AssistantContentPart = TextPart | ReasoningPart | ToolCallPart;

export type InferenceMessage =
  | { role: "user"; content: UserContentPart[] }
  | { role: "assistant"; content: AssistantContentPart[] }
  | { role: "tool"; toolCallId: string; content: UserContentPart[] };

export interface FunctionTool {
  name: string;
  description?: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
  strict?: boolean;
  cacheMarker?: CacheMarker;
}

export type ToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "tool"; name: string };

export type ResponseFormat =
  | { type: "text" }
  | { type: "json-object" }
  | { type: "json-schema"; name: string; schema: Record<string, unknown>; strict?: boolean };

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface InferenceRequest {
  /** The Model name the client asked for (ours, never an Upstream Model id). */
  model: string;
  /** Instructions that come before the conversation, in order. */
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
  /** Null for a non-streaming request. */
  stream: { includeUsage: boolean } | null;
}

export type StopReason = "end" | "max-tokens" | "tool-calls" | "stop-sequence" | "content-filter";

/**
 * Token counts as the upstream reported them; null means it didn't report
 * that count (the Usage Log is then flagged incomplete, nothing is estimated).
 * `inputTokens` excludes the cached input: the input total is
 * inputTokens + cacheReadTokens + cacheWriteTokens.
 */
export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Part of outputTokens, not on top of it. */
  reasoningTokens: number | null;
}

export interface InferenceResponse {
  content: AssistantContentPart[];
  stopReason: StopReason;
  usage: TokenUsage;
}

/**
 * One step of a streamed response. Tool calls are numbered by `index` in the
 * order the model starts them; their arguments arrive in pieces.
 */
export type InferenceStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-signature"; signature: string }
  | { type: "tool-call-start"; index: number; id: string; name: string }
  | { type: "tool-call-delta"; index: number; argumentsDelta: string }
  | { type: "finish"; stopReason: StopReason }
  | { type: "usage"; usage: TokenUsage };

/** Usage before (or without) the upstream reporting any count. */
export const UNREPORTED_USAGE: TokenUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
};
