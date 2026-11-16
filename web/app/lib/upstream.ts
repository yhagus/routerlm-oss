// Providers, Upstream Models and Provider Accounts as the dashboard API returns them.

import type { ReasoningEffort } from "~/lib/parameterPolicy";

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
 * The quirk keys the backend accepts, all edited by the Provider form.
 * `cacheMarkerLimit` applies to `anthropic-messages` Providers, the reasoning,
 * cache and token ones to `openai-chat` ones, and the last two to both. The
 * backend refuses a quirk the Provider's Protocol doesn't read.
 */
export interface ProviderQuirks {
  reasoningContentInHistory?: (typeof REASONING_CONTENT_IN_HISTORY)[number];
  acceptsCacheControl?: boolean;
  acceptsPromptCacheKey?: boolean;
  usesMaxCompletionTokens?: boolean;
  /** How many cache markers the gateway may add per request; absent means Anthropic's four. */
  cacheMarkerLimit?: number;
  /** Reasoning goes out as a `thinking` object, with the Provider's own effort names. */
  reasoningAsThinking?: {
    efforts: Record<ReasoningEffort, string>;
    upstreamModelsWithoutEffort?: string[];
  };
  /** A `prompt_cache_key` the client sent is passed on as it is. */
  forwardsClientPromptCacheKey?: boolean;
  /** The error codes that make a Provider Account Exhausted: numbers or names. */
  exhaustedErrorCodes?: (string | number)[];
  /** Where the quota reader asks, when that is another host than the base URL. */
  quotaBaseUrl?: string;
}

/** The code that reads a Subscription Provider's Quota Meters. */
export const QUOTA_READERS = ["minimax-m-plan", "kimi-code"] as const;
export type QuotaReader = (typeof QUOTA_READERS)[number];

/** For a select: the empty value is a Provider without a quota reader. */
export const QUOTA_READER_OPTIONS = [
  { label: "None", value: "" },
  { label: "MiniMax M Plan", value: "minimax-m-plan" },
  { label: "Kimi Code", value: "kimi-code" },
] satisfies { label: string; value: QuotaReader | "" }[];

/** Where an OAuth Login's account is registered: each region signs in at its own host. */
export const OAUTH_REGIONS = ["global", "china"] as const;
export type OauthRegion = (typeof OAUTH_REGIONS)[number];

export const OAUTH_REGION_LABELS: Record<OauthRegion, string> = {
  global: "Global account",
  china: "Chinese account",
};

/** What signing in to a Provider needs; the gateway runs the flow. */
export interface ProviderOauthLogin {
  authHosts: Record<OauthRegion, string>;
  clientId: string;
  cliVersion: string;
}

export interface Provider {
  id: string;
  slug: string;
  name: string;
  protocol: UpstreamProtocol;
  /** A key into the dashboard's logo set; null picks a mark by the base URL's host. */
  logo: string | null;
  baseUrl: string;
  authStyle: AuthStyle;
  quirks: ProviderQuirks;
  /** Null when the Provider offers no OAuth Login: its accounts hold API keys only. */
  oauthLogin: ProviderOauthLogin | null;
  isEnabled: boolean;
  isFromCatalog: boolean;
  /** The quota endpoint the gateway reads for its accounts; null when it has none. */
  quotaReader: QuotaReader | null;
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

/** What a Quota Meter's `used` and `limit` count. */
export type QuotaMeterUnit = "percent" | "count" | "tokens" | "usd";

/** One quota window of a Provider Account, as its Provider last reported it. */
export interface QuotaMeter {
  /** Such as `5h`, `weekly` or `weekly:video`. */
  key: string;
  label: string;
  unit: QuotaMeterUnit;
  used: number | null;
  limit: number | null;
  /** Null when the Provider reports no percentage. */
  remainingPercent: number | null;
  isUnlimited: boolean;
  windowSeconds: number | null;
  resetsAt: string | null;
  /** The model group it counts, such as `video`; null when it counts every model. */
  scope: string | null;
  observedAt: string;
}

/** What `POST /provider-accounts/:id/quota-reading` answers, also when the reading failed. */
export type ProviderAccountQuota = Pick<
  ProviderAccount,
  "quotaCheckedAt" | "quotaError" | "quotaMeters"
>;

/** The one credential a Provider Account holds. */
export type CredentialKind = "api-key" | "oauth-login";

/** Never the credential itself: an API key's last four characters, nothing of an OAuth Login. */
export interface ProviderAccount {
  id: string;
  providerId: string;
  name: string;
  credentialKind: CredentialKind;
  /** Null for an OAuth Login. */
  keyLastFour: string | null;
  /** The region chosen at sign-in; null for an API key. */
  oauthRegion: OauthRegion | null;
  /** Lower runs first. */
  priority: number;
  isEnabled: boolean;
  /** Why the gateway disabled it, such as an upstream 401. */
  disabledReason: string | null;
  /** When its Cooldown ends; null when it is not in one. Only the list carries it. */
  cooldownEndsAt: string | null;
  /** What put it in Cooldown; `exhausted` while Exhausted, until its Quota Meter resets. */
  cooldownCause: string | null;
  /** Keep serving while Exhausted, when the Provider bills the excess some other way. */
  continueWhenExhausted: boolean;
  /** When its Quota Meters were last read; null when never. */
  quotaCheckedAt: string | null;
  /** Why the last reading failed; null when it succeeded. */
  quotaError: string | null;
  /** Sorted by key. Only the list carries them. */
  quotaMeters: QuotaMeter[];
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A sign-in the operator still has to approve on the Provider's verification page. */
export interface PendingOauthSignIn {
  id: string;
  status: "pending";
  userCode: string;
  verificationUri: string;
  /** The verification page with the code filled in; null when the Provider gives none. */
  verificationUriComplete: string | null;
  expiresAt: string;
}

/** What `GET /provider-accounts/sign-ins/:id` answers; the gateway moves it on. */
export type OauthSignIn =
  | PendingOauthSignIn
  | { id: string; status: "completed"; providerAccount: ProviderAccount }
  | { id: string; status: "denied" }
  | { id: string; status: "expired" };

/**
 * True for an OAuth Login the Provider no longer accepts: the gateway disabled
 * the account and only a new sign-in brings it back. A manual disable leaves
 * no reason.
 */
export function needsNewSignIn(account: ProviderAccount): boolean {
  return (
    account.credentialKind === "oauth-login" &&
    !account.isEnabled &&
    account.disabledReason !== null
  );
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
