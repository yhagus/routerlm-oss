// What the Provider form edits, and the request body it turns into.

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
  type ProviderOauthLogin,
  type ProviderQuirks,
  QUOTA_READERS,
  type QuotaReader,
  REASONING_CONTENT_IN_HISTORY,
} from "~/lib/upstream";

type FlowFields<Login> = Omit<Login, "flow">;

/** Field values as the inputs hold them: "" for an empty select or text field. */
export interface ProviderForm {
  slug: string;
  name: string;
  /** "" picks a mark by the base URL's host. */
  logo: string;
  protocol: string;
  baseUrl: string;
  authStyle: string;
  reasoningContentInHistory: string;
  acceptsCacheControl: boolean;
  acceptsPromptCacheKey: boolean;
  usesMaxCompletionTokens: boolean;
  /** Blank means the default (four). */
  cacheMarkerLimit: number | string;
  hasReasoningAsThinking: boolean;
  thinkingEfforts: Record<ReasoningEffort, string>;
  upstreamModelsWithoutEffort: string[];
  forwardsClientPromptCacheKey: boolean;
  alwaysStreams: boolean;
  includesEncryptedReasoning: boolean;
  systemAsDeveloperMessage: boolean;
  droppedParameters: DroppableParameter[];
  /** As typed; digits-only codes are sent as numbers. */
  exhaustedErrorCodes: string[];
  quotaReader: string;
  quotaBaseUrl: string;
  /** "" for a Provider without OAuth Login. Each flow keeps its fields, so switching back loses nothing. */
  oauthLoginFlow: string;
  kimiCodeOauthLogin: FlowFields<KimiCodeOauthLogin>;
  openAiCodexOauthLogin: FlowFields<OpenAiCodexOauthLogin>;
  credentialKinds: CredentialKind[];
  /** The wire value for each Service Tier, "" when the Provider has no such tier. */
  serviceTierValues: Record<ServiceTier, string>;
}

/** The fields `POST /providers` and `PATCH /providers/:id` share. */
export interface ProviderFields {
  name: string;
  logo: string | null;
  protocol: string;
  baseUrl: string;
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
/** The accents NFKD splits off letters, so "Ü" slugs as "u". */
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

/** The form for a new Provider (no `provider`) or prefilled from an existing one. */
export function providerFormFor(provider: Provider | undefined): ProviderForm {
  const quirks = provider?.quirks ?? {};
  const oauthLogin = provider?.oauthLogin ?? null;
  return {
    slug: provider?.slug ?? "",
    name: provider?.name ?? "",
    logo: provider?.logo ?? "",
    protocol: provider?.protocol ?? "openai-chat",
    baseUrl: provider?.baseUrl ?? "",
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

/** A slug from a Provider's name: "Kimi Code" becomes "kimi-code". */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The request body's shared fields, built from the form alone. */
export function providerFieldsFromForm(form: ProviderForm): ProviderFields {
  return {
    name: form.name,
    logo: form.logo === "" ? null : form.logo,
    protocol: form.protocol,
    baseUrl: form.baseUrl,
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

/** Only the tiers given a wire value: a tier left blank is one the Provider doesn't offer. */
function serviceTierValuesFromForm(form: ProviderForm): Partial<Record<ServiceTier, string>> {
  const values: Partial<Record<ServiceTier, string>> = {};
  for (const tier of SERVICE_TIERS) {
    const value = form.serviceTierValues[tier].trim();
    if (value !== "") values[tier] = value;
  }
  return values;
}

/**
 * Only the quirks that are set, and only those the form's Protocol reads:
 * the backend refuses the other Protocol's quirks, so switching Protocol drops them.
 */
function quirksFromForm(form: ProviderForm): ProviderQuirks {
  return { ...protocolQuirks(form), ...sharedQuirks(form) };
}

function protocolQuirks(form: ProviderForm): ProviderQuirks {
  if (form.protocol === "anthropic-messages") return anthropicMessagesQuirks(form);
  if (form.protocol === "openai-chat") return openaiChatQuirks(form);
  if (form.protocol === "openai-responses") return openaiResponsesQuirks(form);
  return {};
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

/** Quirks every Protocol reads: what makes a Provider Account Exhausted, and where its quota is read. */
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
