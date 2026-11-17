/**
 * What failed: the client's request to the gateway, or one
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
  /** Null for a capture of the client request alone, and for an Attempt that got no response. */
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
  exhausted: "Exhausted",
};

/** What failed, in words: "Client → gateway", or "Gateway → <Provider> · <Provider Account>". */
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

/**
 * What the client received, as a badge. A captured Attempt that Fallback
 * recovered from leaves the client with a success, which is not an error.
 */
export function clientOutcome(capture: Pick<ErrorCaptureSummary, "httpStatus" | "errorCode">): {
  label: string;
  badgeClass: "status-badge--good" | "status-badge--bad";
} {
  if (capture.errorCode === null && capture.httpStatus < 400) {
    return { label: `Recovered · ${capture.httpStatus}`, badgeClass: "status-badge--good" };
  }
  return {
    label: `${capture.errorCode ?? "error"} · ${capture.httpStatus}`,
    badgeClass: "status-badge--bad",
  };
}

/**
 * The message an upstream error body carries, which is what the Provider said
 * went wrong: `error.message` (OpenAI, Anthropic), `error` as a string, or a
 * top-level `message`. Null when the body is not JSON or has none.
 */
export function upstreamErrorMessage(body: string | null): string | null {
  if (body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const error = "error" in parsed ? parsed.error : undefined;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    if (typeof error.message === "string") return error.message;
  }
  return "message" in parsed && typeof parsed.message === "string" ? parsed.message : null;
}

/** A JSON body indented for reading; any other text (a truncated body, HTML) as it is. */
export function readableBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
