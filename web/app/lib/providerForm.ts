import {
  REASONING_EFFORTS,
  type ReasoningEffort,
  SERVICE_TIERS,
  type ServiceTier,
} from "~/lib/parameterPolicy";
import {
  CREDENTIAL_KINDS,
  type CredentialKind,
  type DroppableParameter,
  type KimiCodeOauthLogin,
  OAUTH_LOGIN_FLOWS,
  type OpenAiCodexOauthLogin,
  type Provider,
  type ProviderEndpoint,
  type ProviderOauthLogin,
  type ProviderQuirks,
  QUOTA_READERS,
  type QuotaReader,
  REASONING_CONTENT_IN_HISTORY,
} from "~/lib/upstream";

type FlowFields<Login> = Omit<Login, "flow">;

export interface EndpointForm {
  key: number;
  kind: string;
  protocol: string;
  baseUrl: string;
}

export type EndpointFields = Omit<EndpointForm, "key">;

let nextEndpointKey = 0;

export interface FixedHeaderForm {
  key: number;
  name: string;
  value: string;
}

let nextFixedHeaderKey = 0;

export function fixedHeaderFormFor(name = "", value = ""): FixedHeaderForm {
  nextFixedHeaderKey += 1;
  return { key: nextFixedHeaderKey, name, value };
}

export function endpointFormFor(endpoint?: ProviderEndpoint): EndpointForm {
  nextEndpointKey += 1;
  return {
    key: nextEndpointKey,
    kind: endpoint?.kind ?? "",
    protocol: endpoint?.protocol ?? "",
    baseUrl: endpoint?.baseUrl ?? "",
  };
}

export function chatProtocolsOf(form: Pick<ProviderForm, "endpoints">): string[] {
  return form.endpoints
    .filter((endpoint) => endpoint.kind === "chat")
    .map((endpoint) => endpoint.protocol);
}

export interface ProviderForm {
  slug: string;
  name: string;
  logo: string;
  termsRisk: boolean;
  endpoints: EndpointForm[];
  authStyle: string;
  reasoningContentInHistory: string;
  acceptsCacheControl: boolean;
  acceptsPromptCacheKey: boolean;
  usesMaxCompletionTokens: boolean;
  cacheMarkerLimit: number | string;
  hasReasoningAsThinking: boolean;
  thinkingEfforts: Record<ReasoningEffort, string>;
  upstreamModelsWithoutEffort: string[];
  forwardsClientPromptCacheKey: boolean;
  alwaysStreams: boolean;
  includesEncryptedReasoning: boolean;
  systemAsDeveloperMessage: boolean;
  droppedParameters: DroppableParameter[];
  forwardedClientHeaders: string[];
  fixedHeaders: FixedHeaderForm[];
  exhaustedErrorCodes: string[];
  quotaReader: string;
  quotaBaseUrl: string;
  oauthLoginFlow: string;
  kimiCodeOauthLogin: FlowFields<KimiCodeOauthLogin>;
  openAiCodexOauthLogin: FlowFields<OpenAiCodexOauthLogin>;
  credentialKinds: CredentialKind[];
  serviceTierValues: Record<ServiceTier, string>;
}

export interface ProviderFields {
  name: string;
  logo: string | null;
  termsRisk: boolean;
  endpoints: EndpointFields[];
  authStyle: string;
  quirks: ProviderQuirks;
  quotaReader: QuotaReader | null;
  oauthLogin: ProviderOauthLogin | null;
  credentialKinds: CredentialKind[];
  serviceTierValues: Partial<Record<ServiceTier, string>>;
}

function kimiCodeFields(login: ProviderOauthLogin | null): FlowFields<KimiCodeOauthLogin> {
  if (login?.flow === "kimi-code") {
    return {
      authHosts: { ...login.authHosts },
      clientId: login.clientId,
      cliVersion: login.cliVersion,
    };
  }
  return { authHosts: { global: "", china: "" }, clientId: "", cliVersion: "" };
}

function openAiCodexFields(login: ProviderOauthLogin | null): FlowFields<OpenAiCodexOauthLogin> {
  if (login?.flow === "openai-codex") {
    return { issuer: login.issuer, clientId: login.clientId, cliVersion: login.cliVersion };
  }
  return { issuer: "", clientId: "", cliVersion: "" };
}

const ALL_DIGITS = /^\d+$/;
const COMBINING_MARKS = /\p{Mark}/gu;

function emptyEfforts(): Record<ReasoningEffort, string> {
  return {
    none: "",
    minimal: "",
    low: "",
    medium: "",
    high: "",
    xhigh: "",
  };
}

export function providerFormFor(provider: Provider | undefined): ProviderForm {
  const quirks = provider?.quirks ?? {};
  const oauthLogin = provider?.oauthLogin ?? null;
  return {
    slug: provider?.slug ?? "",
    name: provider?.name ?? "",
    logo: provider?.logo ?? "",
    termsRisk: provider?.termsRisk ?? false,
    endpoints: provider
      ? provider.endpoints.map((endpoint) => endpointFormFor(endpoint))
      : [{ ...endpointFormFor(), kind: "chat", protocol: "openai-chat" }],
    authStyle: provider?.authStyle ?? "bearer",
    reasoningContentInHistory: quirks.reasoningContentInHistory ?? "",
    acceptsCacheControl: quirks.acceptsCacheControl ?? false,
    acceptsPromptCacheKey: quirks.acceptsPromptCacheKey ?? false,
    usesMaxCompletionTokens: quirks.usesMaxCompletionTokens ?? false,
    cacheMarkerLimit: quirks.cacheMarkerLimit ?? "",
    hasReasoningAsThinking: quirks.reasoningAsThinking !== undefined,
    thinkingEfforts: { ...emptyEfforts(), ...quirks.reasoningAsThinking?.efforts },
    upstreamModelsWithoutEffort: [
      ...(quirks.reasoningAsThinking?.upstreamModelsWithoutEffort ?? []),
    ],
    forwardsClientPromptCacheKey: quirks.forwardsClientPromptCacheKey ?? false,
    alwaysStreams: quirks.alwaysStreams ?? false,
    includesEncryptedReasoning: quirks.includesEncryptedReasoning ?? false,
    systemAsDeveloperMessage: quirks.systemAsDeveloperMessage ?? false,
    droppedParameters: [...(quirks.droppedParameters ?? [])],
    forwardedClientHeaders: [...(quirks.forwardedClientHeaders ?? [])],
    fixedHeaders: Object.entries(quirks.fixedHeaders ?? {}).map(([name, value]) =>
      fixedHeaderFormFor(name, value),
    ),
    exhaustedErrorCodes: (quirks.exhaustedErrorCodes ?? []).map(String),
    quotaReader: provider?.quotaReader ?? "",
    quotaBaseUrl: quirks.quotaBaseUrl ?? "",
    oauthLoginFlow: oauthLogin?.flow ?? "",
    kimiCodeOauthLogin: kimiCodeFields(oauthLogin),
    openAiCodexOauthLogin: openAiCodexFields(oauthLogin),
    credentialKinds: [...(provider?.credentialKinds ?? CREDENTIAL_KINDS)],
    serviceTierValues: {
      fast: provider?.serviceTierValues.fast ?? "",
      flex: provider?.serviceTierValues.flex ?? "",
    },
  };
}

export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function providerFieldsFromForm(form: ProviderForm): ProviderFields {
  return {
    name: form.name,
    logo: form.logo === "" ? null : form.logo,
    termsRisk: form.termsRisk,
    endpoints: form.endpoints.map(({ kind, protocol, baseUrl }) => ({ kind, protocol, baseUrl })),
    authStyle: form.authStyle,
    quirks: quirksFromForm(form),
    quotaReader: QUOTA_READERS.find((reader) => reader === form.quotaReader) ?? null,
    oauthLogin: oauthLoginFromForm(form),
    credentialKinds: CREDENTIAL_KINDS.filter((kind) => form.credentialKinds.includes(kind)),
    serviceTierValues: serviceTierValuesFromForm(form),
  };
}

function oauthLoginFromForm(form: ProviderForm): ProviderOauthLogin | null {
  const flow = OAUTH_LOGIN_FLOWS.find((known) => known === form.oauthLoginFlow);
  if (flow === "kimi-code") return { flow, ...structuredClone(form.kimiCodeOauthLogin) };
  if (flow === "openai-codex") return { flow, ...form.openAiCodexOauthLogin };
  return null;
}

function serviceTierValuesFromForm(form: ProviderForm): Partial<Record<ServiceTier, string>> {
  const values: Partial<Record<ServiceTier, string>> = {};
  for (const tier of SERVICE_TIERS) {
    const value = form.serviceTierValues[tier].trim();
    if (value !== "") values[tier] = value;
  }
  return values;
}

function quirksFromForm(form: ProviderForm): ProviderQuirks {
  return { ...protocolQuirks(form), ...sharedQuirks(form) };
}

function protocolQuirks(form: ProviderForm): ProviderQuirks {
  const protocols = chatProtocolsOf(form);
  return {
    ...(protocols.includes("anthropic-messages") ? anthropicMessagesQuirks(form) : {}),
    ...(protocols.includes("openai-chat") ? openaiChatQuirks(form) : {}),
    ...(protocols.includes("openai-responses") ? openaiResponsesQuirks(form) : {}),
  };
}

function openaiResponsesQuirks(form: ProviderForm): ProviderQuirks {
  const quirks: ProviderQuirks = {};
  if (form.acceptsPromptCacheKey) quirks.acceptsPromptCacheKey = true;
  if (form.forwardsClientPromptCacheKey) quirks.forwardsClientPromptCacheKey = true;
  if (form.alwaysStreams) quirks.alwaysStreams = true;
  if (form.includesEncryptedReasoning) quirks.includesEncryptedReasoning = true;
  if (form.systemAsDeveloperMessage) quirks.systemAsDeveloperMessage = true;
  if (form.droppedParameters.length > 0) quirks.droppedParameters = [...form.droppedParameters];
  return quirks;
}

function anthropicMessagesQuirks(form: ProviderForm): ProviderQuirks {
  const limit = form.cacheMarkerLimit;
  return limit === "" ? {} : { cacheMarkerLimit: Number(limit) };
}

function openaiChatQuirks(form: ProviderForm): ProviderQuirks {
  const quirks: ProviderQuirks = {};
  const reasoning = REASONING_CONTENT_IN_HISTORY.find(
    (value) => value === form.reasoningContentInHistory,
  );
  if (reasoning) quirks.reasoningContentInHistory = reasoning;
  if (form.acceptsCacheControl) quirks.acceptsCacheControl = true;
  if (form.acceptsPromptCacheKey) quirks.acceptsPromptCacheKey = true;
  if (form.usesMaxCompletionTokens) quirks.usesMaxCompletionTokens = true;
  if (form.forwardsClientPromptCacheKey) quirks.forwardsClientPromptCacheKey = true;
  if (form.forwardedClientHeaders.length > 0) {
    quirks.forwardedClientHeaders = [...form.forwardedClientHeaders];
  }
  const fixedHeaders = fixedHeadersFromRows(form.fixedHeaders);
  if (Object.keys(fixedHeaders).length > 0) quirks.fixedHeaders = fixedHeaders;
  if (form.hasReasoningAsThinking) {
    const efforts = emptyEfforts();
    for (const effort of REASONING_EFFORTS) efforts[effort] = form.thinkingEfforts[effort].trim();
    quirks.reasoningAsThinking =
      form.upstreamModelsWithoutEffort.length === 0
        ? { efforts }
        : { efforts, upstreamModelsWithoutEffort: [...form.upstreamModelsWithoutEffort] };
  }
  return quirks;
}

function fixedHeadersFromRows(rows: FixedHeaderForm[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim().toLowerCase();
    const value = row.value.trim();
    if (name !== "" && value !== "") headers[name] = value;
  }
  return headers;
}

function sharedQuirks(form: ProviderForm): ProviderQuirks {
  const quirks: ProviderQuirks = {};
  if (form.exhaustedErrorCodes.length > 0) {
    quirks.exhaustedErrorCodes = form.exhaustedErrorCodes.map((code) =>
      ALL_DIGITS.test(code) ? Number(code) : code,
    );
  }
  const quotaBaseUrl = form.quotaBaseUrl.trim();
  if (form.quotaReader !== "" && quotaBaseUrl !== "") quirks.quotaBaseUrl = quotaBaseUrl;
  return quirks;
}
