// Providers, Upstream Models and Provider Accounts as the dashboard API returns them.

export const UPSTREAM_PROTOCOLS = ["openai-chat", "anthropic-messages"] as const;
export type UpstreamProtocol = (typeof UPSTREAM_PROTOCOLS)[number];

/** What the dashboard calls each Protocol: the API it speaks, not its internal value. */
export const PROTOCOL_LABELS: Record<UpstreamProtocol, string> = {
  "openai-chat": "Chat Completions",
  "anthropic-messages": "Messages",
};

export const PROTOCOL_OPTIONS = UPSTREAM_PROTOCOLS.map((protocol) => ({
  label: PROTOCOL_LABELS[protocol],
  value: protocol,
}));

export const AUTH_STYLES = ["bearer", "x-api-key"] as const;
export type AuthStyle = (typeof AUTH_STYLES)[number];

export const CAPABILITIES = ["vision", "tools", "reasoning", "structured-output"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  vision: "Vision",
  tools: "Tool calls",
  reasoning: "Reasoning",
  "structured-output": "Structured output",
};

export const REASONING_CONTENT_IN_HISTORY = ["all-assistant-turns", "tool-call-turns"] as const;

/**
 * The quirk keys the backend accepts: `cacheMarkerLimit` applies to
 * `anthropic-messages` Providers, the others to `openai-chat` ones.
 */
export interface ProviderQuirks {
  reasoningContentInHistory?: (typeof REASONING_CONTENT_IN_HISTORY)[number];
  acceptsCacheControl?: boolean;
  acceptsPromptCacheKey?: boolean;
  usesMaxCompletionTokens?: boolean;
  /** How many cache markers the gateway may add per request; absent means Anthropic's four. */
  cacheMarkerLimit?: number;
}

export interface Provider {
  id: string;
  slug: string;
  name: string;
  protocol: UpstreamProtocol;
  baseUrl: string;
  authStyle: AuthStyle;
  quirks: ProviderQuirks;
  isEnabled: boolean;
  isFromCatalog: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Prices are USD per million tokens; null when the Provider doesn't publish one. */
export interface UpstreamModel {
  id: string;
  providerId: string;
  upstreamModelId: string;
  capabilities: Capability[];
  contextSize: number;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  /** The day the Provider made it available, "YYYY-MM-DD"; null when unknown. */
  releaseDate: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Never the key itself: only its last four characters. */
export interface ProviderAccount {
  id: string;
  providerId: string;
  name: string;
  keyLastFour: string;
  /** Lower runs first. */
  priority: number;
  isEnabled: boolean;
  /** Why the gateway disabled it, such as an upstream 401. */
  disabledReason: string | null;
  /** When its Cooldown ends; null when it is not in one. Only the list carries it. */
  cooldownEndsAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Shortest Provider Account key the backend accepts. */
export const MIN_PROVIDER_ACCOUNT_KEY_LENGTH = 12;

/** A number typed into an optional field, or null when it was left empty. */
export function optionalNumber(typed: string | number): number | null {
  if (typeof typed === "number") return typed;
  return typed.trim() === "" ? null : Number(typed);
}

/** An optional number as a form field shows it: empty for null. */
export function numberField(value: number | null): string {
  return value === null ? "" : String(value);
}
