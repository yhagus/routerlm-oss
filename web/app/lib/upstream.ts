// Providers, Upstream Models and Provider Accounts as the dashboard API returns them.

import type { ReasoningEffort, ServiceTier } from "~/lib/parameterPolicy";

export const UPSTREAM_PROTOCOLS = [
  "openai-chat",
  "anthropic-messages",
  "openai-responses",
] as const;
export type UpstreamProtocol = (typeof UPSTREAM_PROTOCOLS)[number];

/** What the dashboard calls each Protocol: the API it speaks, not its internal value. */
export const PROTOCOL_LABELS: Record<UpstreamProtocol, string> = {
  "openai-chat": "Chat Completions",
  "anthropic-messages": "Messages",
  "openai-responses": "Responses",
};

export const PROTOCOL_OPTIONS = UPSTREAM_PROTOCOLS.map((protocol) => ({
  label: PROTOCOL_LABELS[protocol],
  value: protocol,
}));

/** What a Model or Upstream Model produces; each Kind has its own client endpoints. */
export const MODEL_KINDS = ["chat", "image", "speech", "transcription", "video"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  chat: "Chat",
  image: "Image",
  speech: "Speech",
  transcription: "Transcription",
  video: "Video",
};

export const MODEL_KIND_OPTIONS = MODEL_KINDS.map((kind) => ({
  label: MODEL_KIND_LABELS[kind],
  value: kind,
}));

/** The Model Kind each Protocol serves, as the backend's `PROTOCOL_KINDS` says. */
export const PROTOCOL_KINDS = {
  "openai-chat": "chat",
  "anthropic-messages": "chat",
  "openai-responses": "chat",
} as const satisfies Record<UpstreamProtocol, ModelKind>;

/** The Protocols an endpoint of `kind` may speak; empty while the gateway has none for it. */
export function protocolOptionsFor(kind: string): { label: string; value: UpstreamProtocol }[] {
  return PROTOCOL_OPTIONS.filter((option) => PROTOCOL_KINDS[option.value] === kind);
}

/** The Kinds some Protocol serves: a Provider can have an endpoint only for these. */
export const ENDPOINT_KIND_OPTIONS = MODEL_KIND_OPTIONS.filter(
  (option) => protocolOptionsFor(option.value).length > 0,
);

/** Where a Provider serves one Model Kind, and in which Protocol. */
export interface ProviderEndpoint {
  kind: ModelKind;
  protocol: UpstreamProtocol;
  /** What the Protocol's path is appended to. */
  baseUrl: string;
}

/** The endpoint whose Protocol the quirks follow; undefined for a Provider without chat. */
export function chatEndpointOf(
  provider: Pick<Provider, "endpoints">,
): ProviderEndpoint | undefined {
  return provider.endpoints.find((endpoint) => endpoint.kind === "chat");
}

/** The base URL that stands for a Provider, such as for its logo: the chat endpoint's, else the first. */
export function mainBaseUrl(endpoints: readonly { kind: string; baseUrl: string }[]): string {
  return (endpoints.find((endpoint) => endpoint.kind === "chat") ?? endpoints[0])?.baseUrl ?? "";
}

export const AUTH_STYLES = ["bearer", "x-api-key"] as const;
export type AuthStyle = (typeof AUTH_STYLES)[number];

export const CAPABILITIES = [
  "vision",
  "tools",
  "reasoning",
  "structured-output",
  "text-to-video",
  "first-frame",
  "last-frame",
  "reference-images",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  vision: "Vision",
  tools: "Tool calls",
  reasoning: "Reasoning",
  "structured-output": "Structured output",
  "text-to-video": "Text to video",
  "first-frame": "First frame",
  "last-frame": "Last frame",
  "reference-images": "Reference images",
};

/** Video Capabilities: what a video request may start from or be guided by. */
export const VIDEO_CAPABILITIES = [
  "text-to-video",
  "first-frame",
  "last-frame",
  "reference-images",
] as const satisfies readonly Capability[];

/** The Capabilities that apply to an Upstream Model of `kind`. */
export function capabilitiesFor(kind: ModelKind): readonly Capability[] {
  if (kind === "video") return VIDEO_CAPABILITIES;
  if (kind === "chat") return CAPABILITIES.filter((capability) => !isVideoCapability(capability));
  return [];
}

function isVideoCapability(capability: Capability): boolean {
  return VIDEO_CAPABILITIES.some((video) => video === capability);
}

export const REASONING_CONTENT_IN_HISTORY = ["all-assistant-turns", "tool-call-turns"] as const;

/** The request parameters an `openai-responses` Provider can refuse, so the gateway leaves them out. */
export const DROPPABLE_PARAMETERS = ["temperature", "top_p", "max_output_tokens"] as const;
export type DroppableParameter = (typeof DROPPABLE_PARAMETERS)[number];

/**
 * The quirk keys the backend accepts, all edited by the Provider form.
 * `cacheMarkerLimit` applies to `anthropic-messages` Providers, the reasoning,
 * cache and token ones to `openai-chat` ones, the streaming, developer message
 * and dropped parameter ones to `openai-responses` ones, the prompt cache key
 * ones to both OpenAI Protocols, and the last two to every Protocol. The
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
  /** The Provider answers only as a stream; a non-streaming client's answer is gathered from it. */
  alwaysStreams?: boolean;
  /** Every request asks for the reasoning's encrypted content. */
  includesEncryptedReasoning?: boolean;
  /** The system prompt goes as a `developer` message, not as `instructions`. */
  systemAsDeveloperMessage?: boolean;
  droppedParameters?: DroppableParameter[];
  /** openai-chat only. Lowercase names of client request headers passed on to the Provider when the client sent them. */
  forwardedClientHeaders?: string[];
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

/** How a Provider signs in; the flow itself is the gateway's code. */
export const OAUTH_LOGIN_FLOWS = ["kimi-code", "openai-codex"] as const;
export type OauthLoginFlow = (typeof OAUTH_LOGIN_FLOWS)[number];

export const OAUTH_LOGIN_FLOW_LABELS: Record<OauthLoginFlow, string> = {
  "kimi-code": "Kimi Code device code",
  "openai-codex": "OpenAI Codex CLI device code",
};

/** Kimi Code's sign-in: a User's account lives in one of two regions, each with its own auth host. */
export interface KimiCodeOauthLogin {
  flow: "kimi-code";
  authHosts: Record<OauthRegion, string>;
  clientId: string;
  /** The version of the Provider's CLI the gateway presents itself as. */
  cliVersion: string;
}

/** OpenAI Codex's sign-in as the Codex CLI: one issuer, no regions. */
export interface OpenAiCodexOauthLogin {
  flow: "openai-codex";
  /** The auth host, without a path, such as `https://auth.openai.com`. */
  issuer: string;
  clientId: string;
  /** The version of the Codex CLI the gateway presents itself as. */
  cliVersion: string;
}

/** What signing in to a Provider needs, keyed by its flow; the gateway runs the flow. */
export type ProviderOauthLogin = KimiCodeOauthLogin | OpenAiCodexOauthLogin;

/** The one credential a Provider Account holds. */
export const CREDENTIAL_KINDS = ["api-key", "oauth-login"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_KIND_LABELS: Record<CredentialKind, string> = {
  "api-key": "API key",
  "oauth-login": "OAuth Login",
};

/** One Service Tier's prices, USD per million tokens; a price left out is the standard one. */
export interface TierPrices {
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
}

export interface Provider {
  id: string;
  slug: string;
  name: string;
  /** At least one, at most one per Model Kind. */
  endpoints: ProviderEndpoint[];
  /** A key into the dashboard's logo set; null picks a mark by the main base URL's host. */
  logo: string | null;
  /** The gateway's use of this Provider may breach its documented terms; unusable until Settings allows it. */
  termsRisk: boolean;
  authStyle: AuthStyle;
  quirks: ProviderQuirks;
  /** Null when the Provider offers no OAuth Login: its accounts hold API keys only. */
  oauthLogin: ProviderOauthLogin | null;
  /** The credentials its Provider Accounts may hold; an OAuth Login also needs `oauthLogin`. */
  credentialKinds: CredentialKind[];
  /** What the Provider calls each Service Tier on the wire; empty when it has none. */
  serviceTierValues: Partial<Record<ServiceTier, string>>;
  isEnabled: boolean;
  isFromCatalog: boolean;
  /** The quota endpoint the gateway reads for its accounts; null when it has none. */
  quotaReader: QuotaReader | null;
  createdAt: string;
  updatedAt: string;
}

/** USD per unit by the tier the Provider names, such as `2K` or `720P`. */
export type PricesByTier = Record<string, number>;

/**
 * Token prices are USD per million tokens, unit prices USD per counted unit;
 * null when the Provider doesn't publish one or it belongs to another Kind.
 */
export interface UpstreamModel {
  id: string;
  providerId: string;
  upstreamModelId: string;
  /** The display name from the Provider's docs, e.g. "K2.8 Preview"; null when it has none. */
  name: string | null;
  /** Its Provider has an endpoint for this Kind. */
  kind: ModelKind;
  capabilities: Capability[];
  contextSize: number;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  pricePerImage: number | null;
  pricePerImageBySize: PricesByTier | null;
  pricePerInputImage: number | null;
  pricePerSecondByResolution: PricesByTier | null;
  pricePerMillionCharacters: number | null;
  pricePerAudioSecond: number | null;
  maxInputImages: number | null;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  /** Video resolutions, such as `720P`; null when unknown. */
  resolutions: string[] | null;
  /** Image sizes, such as `1024*1024`; null when unknown. */
  sizes: string[] | null;
  /** The Service Tiers it accepts; a requested tier it doesn't accept is dropped. */
  serviceTiers: ServiceTier[];
  /** Only the tiers that cost other than the standard prices. */
  tierPrices: Partial<Record<ServiceTier, TierPrices>>;
  /** The day the Provider made it available, "YYYY-MM-DD"; null when unknown. */
  releaseDate: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** An Upstream Model as a label reads it: "K2.8 Preview (kimi-for-coding)", or the id alone. */
export function upstreamModelLabel(model: Pick<UpstreamModel, "name" | "upstreamModelId">): string {
  return model.name === null ? model.upstreamModelId : `${model.name} (${model.upstreamModelId})`;
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

/** Never the credential itself: an API key's last four characters, nothing of an OAuth Login. */
export interface ProviderAccount {
  id: string;
  providerId: string;
  name: string;
  credentialKind: CredentialKind;
  /** Null for an OAuth Login. */
  keyLastFour: string | null;
  /** The region chosen at sign-in; null for an API key and for a flow without regions. */
  oauthRegion: OauthRegion | null;
  /**
   * Who signed in and on which plan, from an OpenAI Codex id_token. Absent
   * until the dashboard API returns them, null for other credentials.
   */
  oauthEmail?: string | null;
  oauthPlanType?: string | null;
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

/** Whether the Provider's accounts may hold an API key, an OAuth Login, or both. */
export function acceptsApiKey(provider: Provider): boolean {
  return provider.credentialKinds.includes("api-key");
}

export function offersSignIn(provider: Provider): boolean {
  return provider.oauthLogin !== null && provider.credentialKinds.includes("oauth-login");
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

/** Explains the Terms Risk flag where it is edited. */
export const TERMS_RISK_HINT =
  "Using this Provider through a gateway may breach its terms of use. Blocked until Allow terms-risk providers is turned on in Settings.";
