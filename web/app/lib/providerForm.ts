// What the Provider form edits, and the request body it turns into.

import { REASONING_EFFORTS, type ReasoningEffort } from "~/lib/parameterPolicy";
import {
  type Provider,
  type ProviderOauthLogin,
  type ProviderQuirks,
  QUOTA_READERS,
  type QuotaReader,
  REASONING_CONTENT_IN_HISTORY,
} from "~/lib/upstream";

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
  /** As typed; digits-only codes are sent as numbers. */
  exhaustedErrorCodes: string[];
  quotaReader: string;
  quotaBaseUrl: string;
  hasOauthLogin: boolean;
  oauthLogin: ProviderOauthLogin;
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
}

const EMPTY_OAUTH_LOGIN: ProviderOauthLogin = {
  authHosts: { global: "", china: "" },
  clientId: "",
  cliVersion: "",
};

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
    exhaustedErrorCodes: (quirks.exhaustedErrorCodes ?? []).map(String),
    quotaReader: provider?.quotaReader ?? "",
    quotaBaseUrl: quirks.quotaBaseUrl ?? "",
    hasOauthLogin: oauthLogin !== null,
    oauthLogin: structuredClone(oauthLogin ?? EMPTY_OAUTH_LOGIN),
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
    oauthLogin: form.hasOauthLogin ? structuredClone(form.oauthLogin) : null,
  };
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
  return {};
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
