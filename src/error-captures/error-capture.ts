import type { ClientProtocol, GatewayErrorCode, RecordedAttemptFailure } from "../db/schema.js";

/**
 * What failed: the client's request to the gateway, or
 * one Attempt from the gateway to a Provider Account. Names are null once
 * that Provider Account or Provider is deleted.
 */
export type FailedHop =
  | { kind: "client-to-gateway" }
  | {
      kind: "gateway-to-provider-account";
      attemptId: string;
      providerAccountId: string | null;
      providerAccountName: string | null;
      providerName: string | null;
      /** Null when no response arrived. */
      upstreamStatus: number | null;
      failureReason: RecordedAttemptFailure | null;
    };

/** An Error Capture as the list shows it: its request's outcome, but no content. */
export interface ErrorCaptureSummary {
  id: string;
  createdAt: Date;
  usageLogId: string;
  modelName: string | null;
  apiKeyName: string | null;
  isPlayground: boolean;
  clientProtocol: ClientProtocol;
  httpStatus: number;
  errorCode: GatewayErrorCode | null;
  failedHop: FailedHop;
}

/** One Error Capture whole: redacted headers and truncated bodies. */
export interface ErrorCaptureDetail extends ErrorCaptureSummary {
  requestHeaders: Record<string, string>;
  requestBody: string;
  /** Null for a capture of the client request alone, and for an Attempt that got no response. */
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
}

export interface ErrorCapturePage {
  items: ErrorCaptureSummary[];
  /** How many captures match the filter, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}
