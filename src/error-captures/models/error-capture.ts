import type {
  ClientProtocol,
  GatewayErrorCode,
  RecordedAttemptFailure,
} from "@/db/schemas/index.js";

export type FailedHop =
  | { kind: "client-to-gateway" }
  | {
      kind: "gateway-to-provider-account";
      attemptId: string;
      providerAccountId: string | null;
      providerAccountName: string | null;
      providerName: string | null;
      upstreamStatus: number | null;
      failureReason: RecordedAttemptFailure | null;
      upstreamRequestId: string | null;
    };

export interface ErrorCaptureSummary {
  id: string;
  createdAt: Date;
  usageLogId: string;
  modelName: string | null;
  apiKeyName: string | null;
  integrationId: string | null;
  integrationName: string | null;
  customerId: string | null;
  isPlayground: boolean;
  clientProtocol: ClientProtocol;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
  userAgent: string | null;
  clientIp: string | null;
  failedHop: FailedHop;
}

export interface ErrorCaptureDetail extends ErrorCaptureSummary {
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
}

export interface ErrorCapturePage {
  items: ErrorCaptureSummary[];
  total: number;
  page: number;
  pageSize: number;
}
