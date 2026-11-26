import type { CustomerApiKey, CustomerApiKeyPage, IssuedCustomerApiKey } from "./customer-api-key";
import type { IntegrationModel, IntegrationPricingWindow } from "./integration-model";
import type { IntegrationUsageLog, IntegrationUsageLogPage } from "./integration-usage-log";
import {
  type ApiKeyJson,
  apiKeyJsonOf,
  type ModelJson,
  modelJsonOf,
  type PricingWindowJson,
  pricingWindowJsonOf,
  type UsageLogJson,
  usageLogJsonOf,
} from "./proto-json";

const MILLISECONDS_PER_SECOND = 1000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export interface TimestampMessage {
  seconds: number | string;
  nanos: number;
}

export function timestampMessageOf(date: Date): TimestampMessage {
  const milliseconds = date.getTime();
  const seconds = Math.floor(milliseconds / MILLISECONDS_PER_SECOND);
  return {
    seconds,
    nanos: (milliseconds - seconds * MILLISECONDS_PER_SECOND) * NANOSECONDS_PER_MILLISECOND,
  };
}

export function timestampOf(timestamp: TimestampMessage): Date {
  return new Date(
    Number(timestamp.seconds) * MILLISECONDS_PER_SECOND +
      Math.floor(timestamp.nanos / NANOSECONDS_PER_MILLISECOND),
  );
}

export interface KeySettingsMessage {
  name?: string;
  expiresAt?: TimestampMessage;
  allowedModelIds?: string[];
  spendLimit?: number;
  requestRate?: number;
}

export interface CreateKeyRequest extends KeySettingsMessage {
  customerId?: string;
}

export interface UpdateKeyRequest {
  id?: string;
  key?: KeySettingsMessage;
  updateMask?: { paths?: string[] };
}

export interface KeyIdRequest {
  id?: string;
}

export interface ListKeysRequest {
  customerId?: string;
  pageSize?: number;
  pageToken?: string;
}

export interface ListUsageLogsRequest {
  after?: string;
  pageSize?: number;
}

export interface ApiKeyMessage extends Omit<ApiKeyJson, "createdAt" | "expiresAt" | "revokedAt"> {
  createdAt: TimestampMessage;
  expiresAt?: TimestampMessage;
  revokedAt?: TimestampMessage;
}

export interface IssuedKeyMessage {
  apiKey: ApiKeyMessage;
  key: string;
}

export interface ListKeysResponseMessage {
  keys: ApiKeyMessage[];
  nextPageToken?: string;
}

export interface UsageLogMessage extends Omit<UsageLogJson, "receivedAt"> {
  receivedAt: TimestampMessage;
}

export interface PricingWindowMessage extends Omit<PricingWindowJson, "validFrom" | "validUntil"> {
  validFrom?: TimestampMessage;
  validUntil?: TimestampMessage;
}

export interface ModelMessage extends Omit<ModelJson, "pricingWindows"> {
  pricingWindows: PricingWindowMessage[];
}

export interface ListModelsResponseMessage {
  models: ModelMessage[];
}

export interface ListUsageLogsResponseMessage {
  usageLogs: UsageLogMessage[];
  nextCursor?: string;
}

const optionalTimestampMessageOf = (date: Date | null): TimestampMessage | undefined =>
  date ? timestampMessageOf(date) : undefined;

const optionalIsoStringOf = (timestamp: TimestampMessage | undefined): string | undefined =>
  timestamp ? timestampOf(timestamp).toISOString() : undefined;

export function newKeyJsonOf(request: CreateKeyRequest): object {
  return { ...request, expiresAt: optionalIsoStringOf(request.expiresAt) };
}

const lowerCamelCaseOf = (fieldName: string): string =>
  fieldName.replaceAll(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

export function keyChangesJsonOf(request: UpdateKeyRequest): object {
  const settings: Record<string, unknown> = {
    ...request.key,
    expiresAt: optionalIsoStringOf(request.key?.expiresAt),
  };
  const changes = (request.updateMask?.paths ?? []).map((path) => {
    const field = lowerCamelCaseOf(path);
    const unsetValue = field === "allowedModelIds" ? [] : null;
    return [field, settings[field] ?? unsetValue];
  });
  return Object.fromEntries(changes);
}

export function apiKeyMessageOf(apiKey: CustomerApiKey): ApiKeyMessage {
  return {
    ...apiKeyJsonOf(apiKey),
    createdAt: timestampMessageOf(apiKey.createdAt),
    expiresAt: optionalTimestampMessageOf(apiKey.expiresAt),
    revokedAt: optionalTimestampMessageOf(apiKey.revokedAt),
  };
}

export function issuedKeyMessageOf(issued: IssuedCustomerApiKey): IssuedKeyMessage {
  return { apiKey: apiKeyMessageOf(issued.apiKey), key: issued.key };
}

export function listKeysResponseMessageOf(page: CustomerApiKeyPage): ListKeysResponseMessage {
  return {
    keys: page.keys.map(apiKeyMessageOf),
    nextPageToken: page.nextPageToken ?? undefined,
  };
}

function pricingWindowMessageOf(window: IntegrationPricingWindow): PricingWindowMessage {
  return {
    ...pricingWindowJsonOf(window),
    validFrom: optionalTimestampMessageOf(window.validFrom),
    validUntil: optionalTimestampMessageOf(window.validUntil),
  };
}

function modelMessageOf(model: IntegrationModel): ModelMessage {
  return {
    ...modelJsonOf(model),
    pricingWindows: model.pricingWindows.map(pricingWindowMessageOf),
  };
}

export function listModelsResponseMessageOf(models: IntegrationModel[]): ListModelsResponseMessage {
  return { models: models.map(modelMessageOf) };
}

function usageLogMessageOf(usageLog: IntegrationUsageLog): UsageLogMessage {
  return {
    ...usageLogJsonOf(usageLog),
    receivedAt: timestampMessageOf(usageLog.createdAt),
  };
}

export function listUsageLogsResponseMessageOf(
  page: IntegrationUsageLogPage,
): ListUsageLogsResponseMessage {
  return {
    usageLogs: page.usageLogs.map(usageLogMessageOf),
    nextCursor: page.nextCursor ?? undefined,
  };
}
