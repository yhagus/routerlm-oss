import type { CustomerApiKey, CustomerApiKeyPage, IssuedCustomerApiKey } from "./customer-api-key";
import type { IntegrationModel, IntegrationPricingWindow } from "./integration-model";
import type { IntegrationUsageLog, IntegrationUsageLogPage } from "./integration-usage-log";

export interface ApiKeyJson {
  id: string;
  keyId: string;
  name: string;
  customerId: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  allowedModelIds: string[];
  spendLimit?: number;
  spent: number;
  requestRate?: number;
}

export interface IssuedKeyJson {
  apiKey: ApiKeyJson;
  key: string;
}

export interface ListKeysResponseJson {
  keys: ApiKeyJson[];
  nextPageToken?: string;
}

export interface ModelJson {
  id: string;
  name: string;
  kind: string;
  capabilities: string[];
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  pricePerImage?: number;
  pricePerImageBySize?: Record<string, number>;
  pricePerInputImage?: number;
  pricePerSecondByResolution?: Record<string, number>;
  pricePerMillionCharacters?: number;
  pricePerAudioSecond?: number;
  pricingWindows: PricingWindowJson[];
}

export interface PricingWindowRangeJson {
  weekdays: number[];
  start: string;
  end: string;
}

export interface PricingWindowJson {
  timeZone: string;
  ranges: PricingWindowRangeJson[];
  validFrom?: string;
  validUntil?: string;
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
}

export interface ListModelsResponseJson {
  models: ModelJson[];
}

export interface UsageLogJson {
  id: string;
  receivedAt: string;
  apiKeyId: string;
  apiKeyName?: string;
  customerId: string;
  modelName?: string;
  kind: string;
  clientProtocol: string;
  streamed: boolean;
  httpStatus: number;
  errorCode?: string;
  errorOrigin?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  imagesOut?: number;
  imagesIn?: number;
  outputSeconds?: number;
  audioSeconds?: number;
  characters?: number;
  cost?: number;
  timeToFirstTokenMs?: number;
  durationMs: number;
  cancelled: boolean;
  incomplete: boolean;
}

export interface ListUsageLogsResponseJson {
  usageLogs: UsageLogJson[];
  nextCursor?: string;
}

export interface ErrorJson {
  code: string;
  message: string;
}

export function apiKeyJsonOf(apiKey: CustomerApiKey): ApiKeyJson {
  return {
    id: apiKey.id,
    keyId: apiKey.keyId,
    name: apiKey.name,
    customerId: apiKey.customerId,
    createdAt: apiKey.createdAt.toISOString(),
    expiresAt: apiKey.expiresAt?.toISOString(),
    revokedAt: apiKey.revokedAt?.toISOString(),
    allowedModelIds: apiKey.allowedModelIds,
    spendLimit: apiKey.spendLimit ?? undefined,
    spent: apiKey.spent,
    requestRate: apiKey.requestRate ?? undefined,
  };
}

export function issuedKeyJsonOf(issued: IssuedCustomerApiKey): IssuedKeyJson {
  return { apiKey: apiKeyJsonOf(issued.apiKey), key: issued.key };
}

export function listKeysResponseJsonOf(page: CustomerApiKeyPage): ListKeysResponseJson {
  return {
    keys: page.keys.map(apiKeyJsonOf),
    nextPageToken: page.nextPageToken ?? undefined,
  };
}

export function usageLogJsonOf(usageLog: IntegrationUsageLog): UsageLogJson {
  return {
    id: usageLog.id,
    receivedAt: usageLog.createdAt.toISOString(),
    apiKeyId: usageLog.apiKeyId ?? "",
    apiKeyName: usageLog.apiKeyName ?? undefined,
    customerId: usageLog.customerId ?? "",
    modelName: usageLog.modelName ?? undefined,
    kind: usageLog.kind,
    clientProtocol: usageLog.clientProtocol,
    streamed: usageLog.isStreamed,
    httpStatus: usageLog.httpStatus,
    errorCode: usageLog.errorCode ?? undefined,
    errorOrigin: usageLog.errorOrigin ?? undefined,
    inputTokens: usageLog.inputTokens ?? undefined,
    outputTokens: usageLog.outputTokens ?? undefined,
    cacheReadTokens: usageLog.cacheReadTokens ?? undefined,
    cacheWriteTokens: usageLog.cacheWriteTokens ?? undefined,
    reasoningTokens: usageLog.reasoningTokens ?? undefined,
    imagesOut: usageLog.imagesOut ?? undefined,
    imagesIn: usageLog.imagesIn ?? undefined,
    outputSeconds: usageLog.outputSeconds ?? undefined,
    audioSeconds: usageLog.audioSeconds ?? undefined,
    characters: usageLog.characters ?? undefined,
    cost: usageLog.cost ?? undefined,
    timeToFirstTokenMs: usageLog.timeToFirstTokenMs ?? undefined,
    durationMs: usageLog.durationMs,
    cancelled: usageLog.isCancelled,
    incomplete: usageLog.isIncomplete,
  };
}

export function listUsageLogsResponseJsonOf(
  page: IntegrationUsageLogPage,
): ListUsageLogsResponseJson {
  return {
    usageLogs: page.usageLogs.map(usageLogJsonOf),
    nextCursor: page.nextCursor ?? undefined,
  };
}

export function modelJsonOf(model: IntegrationModel): ModelJson {
  const { prices } = model;
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    capabilities: model.capabilities,
    inputPrice: prices?.inputPrice ?? undefined,
    outputPrice: prices?.outputPrice ?? undefined,
    cacheReadPrice: prices?.cacheReadPrice ?? undefined,
    cacheWritePrice: prices?.cacheWritePrice ?? undefined,
    pricePerImage: prices?.unitPrices.pricePerImage ?? undefined,
    pricePerImageBySize: prices?.unitPrices.pricePerImageBySize ?? undefined,
    pricePerInputImage: prices?.unitPrices.pricePerInputImage ?? undefined,
    pricePerSecondByResolution: prices?.unitPrices.pricePerSecondByResolution ?? undefined,
    pricePerMillionCharacters: prices?.unitPrices.pricePerMillionCharacters ?? undefined,
    pricePerAudioSecond: prices?.unitPrices.pricePerAudioSecond ?? undefined,
    pricingWindows: model.pricingWindows.map(pricingWindowJsonOf),
  };
}

export function pricingWindowJsonOf(window: IntegrationPricingWindow): PricingWindowJson {
  const { prices } = window;
  return {
    timeZone: window.timeZone,
    ranges: window.ranges,
    validFrom: window.validFrom?.toISOString(),
    validUntil: window.validUntil?.toISOString(),
    inputPrice: prices.inputPrice ?? undefined,
    outputPrice: prices.outputPrice ?? undefined,
    cacheReadPrice: prices.cacheReadPrice ?? undefined,
    cacheWritePrice: prices.cacheWritePrice ?? undefined,
  };
}

export function listModelsResponseJsonOf(models: IntegrationModel[]): ListModelsResponseJson {
  return { models: models.map(modelJsonOf) };
}
