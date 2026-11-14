/**
 * Which hop of a request failed: the client's request to the gateway, or one
 * Attempt from the gateway to a Provider Account. Names are null once that
 * Provider Account or Provider is deleted.
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
      failureReason: string | null;
    };

/** An Error Capture as `GET /api/error-captures` lists it: no headers or bodies. */
export interface ErrorCaptureSummary {
  id: string;
  createdAt: string;
  usageLogId: string;
  modelName: string | null;
  apiKeyName: string | null;
  isPlayground: boolean;
  clientProtocol: string;
  httpStatus: number;
  errorCode: string | null;
  failedHop: FailedHop;
}

/** One Error Capture whole, from `GET /api/error-captures/:id`. Credentials are already redacted. */
export interface ErrorCaptureDetail extends ErrorCaptureSummary {
  requestHeaders: Record<string, string>;
  requestBody: string;
  /** Null for the client-to-gateway hop, and for an Attempt that got no response. */
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
}

export interface ErrorCapturePage {
  items: ErrorCaptureSummary[];
  total: number;
  page: number;
  pageSize: number;
}

const FAILURE_REASON_LABELS: Record<string, string> = {
  rate_limited: "Rate limited",
  server_error: "Server error",
  timeout: "Timed out",
  connection_error: "Connection error",
  unauthorized: "Key refused",
  bad_request: "Bad request",
  stream_interrupted: "Stream interrupted",
};

/** The hop in words: "Client → gateway", or "Gateway → <Provider> · <Provider Account>". */
export function failedHopLabel(hop: FailedHop): string {
  if (hop.kind === "client-to-gateway") return "Client → gateway";
  const provider = hop.providerName ?? "Deleted Provider";
  const account = hop.providerAccountName ?? "Deleted Provider Account";
  return `Gateway → ${provider} · ${account}`;
}

/** Why the Attempt failed, with the upstream's status when it answered. */
export function attemptOutcomeLabel(
  hop: Extract<FailedHop, { kind: "gateway-to-provider-account" }>,
): string {
  const reason = hop.failureReason
    ? (FAILURE_REASON_LABELS[hop.failureReason] ?? hop.failureReason)
    : "Failed";
  return hop.upstreamStatus === null
    ? `${reason} · no response`
    : `${reason} · HTTP ${hop.upstreamStatus}`;
}

/** A JSON body indented for reading; any other text (a truncated body, HTML) as it is. */
export function readableBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
