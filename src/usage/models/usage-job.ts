import type {
  ClientProtocol,
  ErrorOrigin,
  FinishReason,
  PricesByTier,
  GatewayErrorCode,
  RecordedAttemptFailure,
  UpstreamProtocol,
} from '@/db/schemas';
import type { ReasoningEffort, ServiceTier, TokenUsage } from '@/inference/models/internal-format';

export interface MediaUnits {
  imagesOut?: number;
  imagesIn?: number;
  outputSeconds?: number;
  audioSeconds?: number;
  characters?: number;
  tier?: string;
}

export interface SentParameters {
  maxOutputTokens: number | null;
  reasoningEffort: ReasoningEffort | null;
  thinkingBudgetTokens: number | null;
}

export const RECORD_USAGE_JOB = 'record';

export type UsageCaller =
  | {
      kind: 'api-key';
      apiKeyId: string;
      apiKeyName: string;
      customer: UsageCustomer | null;
    }
  | { kind: 'playground'; userId: string; userEmail: string }
  | { kind: 'unidentified' };

export interface UsageCustomer {
  integrationId: string;
  integrationName: string;
  customerId: string;
}

export interface UpstreamModelPrices {
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
}

export interface UpstreamModelUnitPrices {
  pricePerImage: number | null;
  pricePerImageBySize: PricesByTier | null;
  pricePerInputImage: number | null;
  pricePerSecondByResolution: PricesByTier | null;
  pricePerMillionCharacters: number | null;
  pricePerAudioSecond: number | null;
}

export interface ServingTarget {
  routeId: string | null;
  upstreamModelId: string;
  upstreamModelName: string;
  providerSlug: string;
  providerName: string;
  providerAccountId: string;
  providerAccountName: string;
}

export interface RequestNames {
  modelName: string | null;
  apiKeyName: string | null;
}

export interface ServedBy extends ServingTarget {
  upstreamProtocol: UpstreamProtocol;
  serviceTier: ServiceTier | null;
  prices: UpstreamModelPrices;
  pricingWindowName: string | null;
  unitPrices: UpstreamModelUnitPrices;
}

export interface AttemptRecord extends ServingTarget {
  startedAt: string;
  upstreamProtocol: UpstreamProtocol | null;
  upstreamStatus: number | null;
  failureReason: RecordedAttemptFailure | null;
  durationMs: number;
  upstreamRequestId: string | null;
}

export interface CapturedMessage {
  headers: Record<string, string>;
  body: string;
}

export interface FailedAttemptCapture {
  captureId: string;
  attemptIndex: number;
  upstreamResponse: CapturedMessage | null;
}

export interface ErrorCaptureRecord {
  requestCaptureId: string;
  request: CapturedMessage;
  failedAttempts: FailedAttemptCapture[];
}

export interface UsageJob {
  usageLogId: string;
  receivedAt: string;
  caller: UsageCaller;
  modelId: string | null;
  modelName: string | null;
  requestedModelName: string | null;
  clientProtocol: ClientProtocol;
  isStreamed: boolean;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
  errorOrigin: ErrorOrigin | null;
  userAgent: string | null;
  clientIp: string | null;
  servedBy: ServedBy | null;
  usage: TokenUsage | null;
  units: MediaUnits | null;
  requestBytes: number;
  responseBytes: number;
  timeToFirstTokenMs: number | null;
  isReasoningStreamed: boolean;
  finishReason: FinishReason | null;
  sentParameters: SentParameters | null;
  toolCount: number;
  toolCallCount: number;
  durationMs: number;
  slotWaitMs: number;
  isCancelled: boolean;
  attempts: AttemptRecord[];
  errorCapture: ErrorCaptureRecord | null;
}
