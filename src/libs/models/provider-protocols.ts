import type { StoredProviderQuirks } from "@/catalog/schemas/catalog.schema";
import {
  type ModelKind,
  PROTOCOLS_WITH_SERVICE_TIERS,
  type ProviderEndpoint,
  type UpstreamProtocol,
} from "@/db/schemas";

type QuirkKey = keyof StoredProviderQuirks;

export interface ProtocolListing {
  kind?: ModelKind;
  protocols?: readonly UpstreamProtocol[];
}

const QUIRKS_OF_EVERY_PROTOCOL: readonly QuirkKey[] = ["exhaustedErrorCodes", "quotaBaseUrl"];

const QUIRKS_OF_ONE_PROTOCOL = {
  "openai-chat": [
    "reasoningContentInHistory",
    "acceptsCacheControl",
    "reasoningAsThinking",
    "forwardsClientPromptCacheKey",
    "acceptsPromptCacheKey",
    "usesMaxCompletionTokens",
    "forwardedClientHeaders",
    "fixedHeaders",
  ],
  "anthropic-messages": ["cacheMarkerLimit"],
  "openai-responses": [
    "forwardsClientPromptCacheKey",
    "acceptsPromptCacheKey",
    "alwaysStreams",
    "includesEncryptedReasoning",
    "systemAsDeveloperMessage",
    "droppedParameters",
  ],
  "dashscope-image": [],
  "dashscope-video": [],
  "dashscope-speech": [],
  "dashscope-transcription": [],
} as const satisfies Record<UpstreamProtocol, readonly QuirkKey[]>;

export function protocolsOf(endpoints: readonly ProviderEndpoint[]): UpstreamProtocol[] {
  return endpoints.map((endpoint) => endpoint.protocol);
}

export function describeProtocols(endpoints: readonly ProviderEndpoint[]): string {
  return protocolsOf(endpoints).join(" or ");
}

export function kindOf(upstreamModel: ProtocolListing): ModelKind {
  return upstreamModel.kind ?? "chat";
}

export function protocolsWithoutEndpoint(
  upstreamModel: ProtocolListing,
  endpoints: readonly ProviderEndpoint[],
): UpstreamProtocol[] {
  const kind = kindOf(upstreamModel);
  return (upstreamModel.protocols ?? []).filter(
    (protocol) =>
      !endpoints.some((endpoint) => endpoint.protocol === protocol && endpoint.kind === kind),
  );
}

export function quirksUnderstoodBy(protocols: readonly UpstreamProtocol[]): QuirkKey[] {
  return [
    ...QUIRKS_OF_EVERY_PROTOCOL,
    ...protocols.flatMap((protocol) => QUIRKS_OF_ONE_PROTOCOL[protocol]),
  ];
}

export function quirksSentThrough(
  protocol: UpstreamProtocol,
  quirks: StoredProviderQuirks,
): StoredProviderQuirks {
  const sent: StoredProviderQuirks = {};
  for (const key of quirksUnderstoodBy([protocol])) {
    copyQuirk(quirks, sent, key);
  }
  return sent;
}

function copyQuirk<Key extends QuirkKey>(
  from: StoredProviderQuirks,
  to: StoredProviderQuirks,
  key: Key,
): void {
  if (Object.hasOwn(from, key)) {
    to[key] = from[key];
  }
}

export function sendsServiceTiers(protocol: UpstreamProtocol): boolean {
  return PROTOCOLS_WITH_SERVICE_TIERS.some((sending) => sending === protocol);
}
