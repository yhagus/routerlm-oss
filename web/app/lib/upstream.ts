import type { ReasoningEffort, ServiceTier } from '~/lib/parameterPolicy';
import type { AttachedPricingWindow } from '~/lib/pricingWindows';

export const UPSTREAM_PROTOCOLS = [
  'openai-chat',
  'anthropic-messages',
  'openai-responses',
  'dashscope-image',
  'dashscope-video',
  'dashscope-speech',
  'dashscope-transcription',
] as const;
export type UpstreamProtocol = (typeof UPSTREAM_PROTOCOLS)[number];

export const PROTOCOL_LABELS: Record<UpstreamProtocol, string> = {
  'openai-chat': 'Chat Completions',
  'anthropic-messages': 'Messages',
  'openai-responses': 'Responses',
  'dashscope-image': 'DashScope Image',
  'dashscope-video': 'DashScope Video',
  'dashscope-speech': 'DashScope Speech',
  'dashscope-transcription': 'DashScope Transcription',
};

export const PROTOCOL_OPTIONS = UPSTREAM_PROTOCOLS.map((protocol) => ({
  label: PROTOCOL_LABELS[protocol],
  value: protocol,
}));

export const MODEL_KINDS = ['chat', 'image', 'speech', 'transcription', 'video'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  chat: 'Chat',
  image: 'Image',
  speech: 'Speech',
  transcription: 'Transcription',
  video: 'Video',
};

export const MODEL_KIND_OPTIONS = MODEL_KINDS.map((kind) => ({
  label: MODEL_KIND_LABELS[kind],
  value: kind,
}));

export const PROTOCOL_KINDS = {
  'openai-chat': 'chat',
  'anthropic-messages': 'chat',
  'openai-responses': 'chat',
  'dashscope-image': 'image',
  'dashscope-video': 'video',
  'dashscope-speech': 'speech',
  'dashscope-transcription': 'transcription',
} as const satisfies Record<UpstreamProtocol, ModelKind>;

export function protocolOptionsFor(kind: string): { label: string; value: UpstreamProtocol }[] {
  return PROTOCOL_OPTIONS.filter((option) => PROTOCOL_KINDS[option.value] === kind);
}

export const ENDPOINT_KIND_OPTIONS = MODEL_KIND_OPTIONS.filter(
  (option) => protocolOptionsFor(option.value).length > 0,
);

export interface ProviderEndpoint {
  kind: ModelKind;
  protocol: UpstreamProtocol;
  baseUrl: string;
}

export function servesProtocol(
  endpoints: readonly ProviderEndpoint[],
  protocol: UpstreamProtocol,
): boolean {
  return endpoints.some((endpoint) => endpoint.protocol === protocol);
}

export function endpointProtocolsOf(
  endpoints: readonly ProviderEndpoint[],
  kind: ModelKind,
): UpstreamProtocol[] {
  return endpoints
    .filter((endpoint) => endpoint.kind === kind)
    .map((endpoint) => endpoint.protocol);
}

export function mainBaseUrl(endpoints: readonly { kind: string; baseUrl: string }[]): string {
  return (endpoints.find((endpoint) => endpoint.kind === 'chat') ?? endpoints[0])?.baseUrl ?? '';
}

export const AUTH_STYLES = ['bearer', 'x-api-key'] as const;
export type AuthStyle = (typeof AUTH_STYLES)[number];

export const CAPABILITIES = [
  'vision',
  'tools',
  'reasoning',
  'structured-output',
  'text-to-video',
  'first-frame',
  'last-frame',
  'reference-images',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  vision: 'Vision',
  tools: 'Tool calls',
  reasoning: 'Reasoning',
  'structured-output': 'Structured output',
  'text-to-video': 'Text to video',
  'first-frame': 'First frame',
  'last-frame': 'Last frame',
  'reference-images': 'Reference images',
};

export const VIDEO_CAPABILITIES = [
  'text-to-video',
  'first-frame',
  'last-frame',
  'reference-images',
] as const satisfies readonly Capability[];

export function capabilitiesFor(kind: ModelKind): readonly Capability[] {
  if (kind === 'video') return VIDEO_CAPABILITIES;
  if (kind === 'chat') return CAPABILITIES.filter((capability) => !isVideoCapability(capability));
  return [];
}

function isVideoCapability(capability: Capability): boolean {
  return VIDEO_CAPABILITIES.some((video) => video === capability);
}

export const REASONING_CONTENT_IN_HISTORY = ['all-assistant-turns', 'tool-call-turns'] as const;

export const DROPPABLE_PARAMETERS = ['temperature', 'top_p', 'max_output_tokens'] as const;
export type DroppableParameter = (typeof DROPPABLE_PARAMETERS)[number];

export interface ProviderQuirks {
  reasoningContentInHistory?: (typeof REASONING_CONTENT_IN_HISTORY)[number];
  acceptsCacheControl?: boolean;
  acceptsPromptCacheKey?: boolean;
  usesMaxCompletionTokens?: boolean;
  cacheMarkerLimit?: number;
  reasoningAsThinking?: {
    efforts: Record<ReasoningEffort, string>;
    upstreamModelsWithoutEffort?: string[];
  };
  forwardsClientPromptCacheKey?: boolean;
  alwaysStreams?: boolean;
  includesEncryptedReasoning?: boolean;
  systemAsDeveloperMessage?: boolean;
  droppedParameters?: DroppableParameter[];
  forwardedClientHeaders?: string[];
  fixedHeaders?: Record<string, string>;
  exhaustedErrorCodes?: (string | number)[];
  notInPlanErrorCodes?: (string | number)[];
  quotaBaseUrl?: string;
}

export const QUOTA_READERS = ['minimax-m-plan', 'kimi-code', 'openai-codex'] as const;
export type QuotaReader = (typeof QUOTA_READERS)[number];
export const PLAN_READERS = ['tokenharbor'] as const;
export type PlanReader = (typeof PLAN_READERS)[number];

export const QUOTA_READER_OPTIONS = [
  { label: 'None', value: '' },
  { label: 'MiniMax M Plan', value: 'minimax-m-plan' },
  { label: 'Kimi Code', value: 'kimi-code' },
  { label: 'OpenAI Codex', value: 'openai-codex' },
] satisfies { label: string; value: QuotaReader | '' }[];

export const OAUTH_REGIONS = ['global', 'china'] as const;
export type OauthRegion = (typeof OAUTH_REGIONS)[number];

export const OAUTH_REGION_LABELS: Record<OauthRegion, string> = {
  global: 'Global account',
  china: 'Chinese account',
};

export const OAUTH_LOGIN_FLOWS = ['kimi-code', 'openai-codex'] as const;
export type OauthLoginFlow = (typeof OAUTH_LOGIN_FLOWS)[number];

export const OAUTH_LOGIN_FLOW_LABELS: Record<OauthLoginFlow, string> = {
  'kimi-code': 'Kimi Code device code',
  'openai-codex': 'OpenAI Codex CLI device code',
};

export interface KimiCodeOauthLogin {
  flow: 'kimi-code';
  authHosts: Record<OauthRegion, string>;
  clientId: string;
  cliVersion: string;
}

export interface OpenAiCodexOauthLogin {
  flow: 'openai-codex';
  issuer: string;
  clientId: string;
  cliVersion: string;
}

export type ProviderOauthLogin = KimiCodeOauthLogin | OpenAiCodexOauthLogin;

export const CREDENTIAL_KINDS = ['api-key', 'oauth-login'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_KIND_LABELS: Record<CredentialKind, string> = {
  'api-key': 'API key',
  'oauth-login': 'OAuth Login',
};

export interface TierPrices {
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
}

export interface ProviderPlan {
  value: string;
  name: string;
}

export interface Provider {
  id: string;
  slug: string;
  name: string;
  endpoints: ProviderEndpoint[];
  logo: string | null;
  termsRisk: boolean;
  verified: boolean;
  verifiedAt: string | null;
  authStyle: AuthStyle;
  quirks: ProviderQuirks;
  oauthLogin: ProviderOauthLogin | null;
  credentialKinds: CredentialKind[];
  serviceTierValues: Partial<Record<ServiceTier, string>>;
  isEnabled: boolean;
  isFromCatalog: boolean;
  quotaReader: QuotaReader | null;
  planReader: PlanReader | null;
  plans: ProviderPlan[];
  allowsNoPlan: boolean;
  createdAt: string;
  updatedAt: string;
}

export function verifiedHint(verifiedAt: string | null): string {
  const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;
  return verifiedAt ? `Verified on ${verifiedAt.slice(0, ISO_DATE_LENGTH)}` : 'Verified';
}

export type PricesByTier = Record<string, number>;

export interface UpstreamModel {
  id: string;
  providerId: string;
  upstreamModelId: string;
  name: string | null;
  kind: ModelKind;
  protocols: UpstreamProtocol[];
  capabilities: Capability[];
  contextSize: number | null;
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
  resolutions: string[] | null;
  sizes: string[] | null;
  serviceTiers: ServiceTier[];
  tierPrices: Partial<Record<ServiceTier, TierPrices>>;
  releaseDate: string | null;
  planCoverage: string[] | null;
  planCoverageCheckedAt: string | null;
  isEnabled: boolean;
  pricingWindows: AttachedPricingWindow[];
  createdAt: string;
  updatedAt: string;
}

export function upstreamModelLabel(model: Pick<UpstreamModel, 'name' | 'upstreamModelId'>): string {
  return model.name === null ? model.upstreamModelId : `${model.name} (${model.upstreamModelId})`;
}

export function planCoverageNote(model: Pick<UpstreamModel, 'planCoverage'>): string | null {
  if (model.planCoverage === null) return null;
  if (model.planCoverage.length === 0) return 'No plan covers this model';
  return model.planCoverage.join(', ');
}

export type QuotaMeterUnit = 'percent' | 'count' | 'tokens' | 'usd';

export interface QuotaMeter {
  key: string;
  label: string;
  unit: QuotaMeterUnit;
  used: number | null;
  limit: number | null;
  remainingPercent: number | null;
  isUnlimited: boolean;
  windowSeconds: number | null;
  resetsAt: string | null;
  scope: string | null;
  observedAt: string;
}

export interface UsageReset {
  id: string;
  title: string;
  grantedAt: string;
  expiresAt: string | null;
}

export type ProviderAccountQuota = Pick<
  ProviderAccount,
  'quotaCheckedAt' | 'quotaError' | 'quotaMeters' | 'usageResets'
>;

export interface ProviderAccount {
  id: string;
  providerId: string;
  name: string;
  credentialKind: CredentialKind;
  keyLastFour: string | null;
  oauthRegion: OauthRegion | null;
  oauthEmail?: string | null;
  plan: string | null;
  planChoice: string;
  planCheckedAt: string | null;
  paysBeyondPlan: boolean;
  priority: number;
  concurrencyLimit: number | null;
  isEnabled: boolean;
  disabledReason: string | null;
  cooldownEndsAt: string | null;
  cooldownCause: string | null;
  continueWhenExhausted: boolean;
  quotaCheckedAt: string | null;
  quotaError: string | null;
  quotaMeters: QuotaMeter[];
  usageResets: UsageReset[] | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingOauthSignIn {
  id: string;
  status: 'pending';
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: string;
}

export type OauthSignIn =
  | PendingOauthSignIn
  | { id: string; status: 'completed'; providerAccount: ProviderAccount }
  | { id: string; status: 'denied' }
  | { id: string; status: 'expired' };

export function needsNewSignIn(account: ProviderAccount): boolean {
  return (
    account.credentialKind === 'oauth-login' &&
    !account.isEnabled &&
    account.disabledReason !== null
  );
}

export const AUTO_PLAN_CHOICE = 'auto';
export const NO_PLAN_CHOICE = 'none';

export function offersPlanChoice(provider: Provider): boolean {
  return provider.plans.length > 0;
}

export function planChoiceOptions(provider: Provider): { label: string; value: string }[] {
  return [
    { label: 'Auto', value: AUTO_PLAN_CHOICE },
    ...(provider.allowsNoPlan ? [{ label: 'None (pay as you go)', value: NO_PLAN_CHOICE }] : []),
    ...provider.plans.map((plan) => ({ label: plan.name, value: plan.value })),
  ];
}

export function listedPlanName(provider: Provider, value: string): string | null {
  return provider.plans.find((plan) => plan.value === value)?.name ?? null;
}

export function acceptsApiKey(provider: Provider): boolean {
  return provider.credentialKinds.includes('api-key');
}

export function offersSignIn(provider: Provider): boolean {
  return provider.oauthLogin !== null && provider.credentialKinds.includes('oauth-login');
}

export const MIN_PROVIDER_ACCOUNT_KEY_LENGTH = 12;

export function optionalNumber(typed: string | number): number | null {
  if (typeof typed === 'number') return typed;
  return typed.trim() === '' ? null : Number(typed);
}

export function numberField(value: number | null): string {
  return value === null ? '' : String(value);
}
