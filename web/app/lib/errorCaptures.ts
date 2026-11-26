import type { RecordedIntegration } from '~/lib/integrations';

export type FailedHop =
  | { kind: 'client-to-gateway' }
  | {
      kind: 'gateway-to-provider-account';
      attemptId: string;
      providerAccountId: string | null;
      providerAccountName: string | null;
      providerName: string | null;
      upstreamStatus: number | null;
      failureReason: string | null;
      upstreamRequestId: string | null;
    };

export interface ErrorCaptureSummary extends RecordedIntegration {
  id: string;
  createdAt: string;
  usageLogId: string;
  modelName: string | null;
  apiKeyName: string | null;
  isPlayground: boolean;
  clientProtocol: string;
  upstreamProtocol: string | null;
  httpStatus: number;
  errorCode: string | null;
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

/** Which hop a capture failed at, as the backend's `FAILED_HOPS` says. */
export const FAILED_HOPS = ['client-to-gateway', 'gateway-to-provider-account'] as const;
export type FailedHopKind = (typeof FAILED_HOPS)[number];

export const FAILED_HOP_LABELS: Record<FailedHopKind, string> = {
  'client-to-gateway': 'Client → gateway',
  'gateway-to-provider-account': 'Gateway → Provider',
};

/** How the client's request ended despite the capture, as the backend's `CAPTURE_OUTCOMES` says. */
export const CAPTURE_OUTCOMES = ['recovered', 'failed'] as const;
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

export const CAPTURE_OUTCOME_LABELS: Record<CaptureOutcome, string> = {
  recovered: 'Recovered',
  failed: 'Failed',
};

export interface ErrorCapturePage {
  items: ErrorCaptureSummary[];
  total: number;
  page: number;
  pageSize: number;
}

const FAILURE_REASON_LABELS: Record<string, string> = {
  rate_limited: 'Rate limited',
  server_error: 'Server error',
  timeout: 'Timed out',
  connection_error: 'Connection error',
  unauthorized: 'Key refused',
  bad_request: 'Bad request',
  stream_interrupted: 'Stream interrupted',
  exhausted: 'Exhausted',
  cancelled: 'Cancelled',
};

export function failedHopLabel(hop: FailedHop): string {
  if (hop.kind === 'client-to-gateway') return 'Client → gateway';
  const provider = hop.providerName ?? 'Deleted Provider';
  const account = hop.providerAccountName ?? 'Deleted Provider Account';
  return `Gateway → ${provider} · ${account}`;
}

export function failureReasonLabel(reason: string): string {
  return FAILURE_REASON_LABELS[reason] ?? reason;
}

export function attemptOutcomeLabel(
  attempt: { failureReason: string | null; upstreamStatus: number | null },
  labelWithoutReason: string,
): string {
  const reason = attempt.failureReason
    ? failureReasonLabel(attempt.failureReason)
    : labelWithoutReason;
  return attempt.upstreamStatus === null
    ? `${reason} · no response`
    : `${reason} · HTTP ${attempt.upstreamStatus}`;
}

export function clientOutcome(capture: Pick<ErrorCaptureSummary, 'httpStatus' | 'errorCode'>): {
  label: string;
  badgeClass: 'status-badge--good' | 'status-badge--bad';
} {
  if (capture.errorCode === null && capture.httpStatus < 400) {
    return { label: `Recovered · ${capture.httpStatus}`, badgeClass: 'status-badge--good' };
  }
  return {
    label: `${capture.errorCode ?? 'error'} · ${capture.httpStatus}`,
    badgeClass: 'status-badge--bad',
  };
}

export function upstreamErrorMessage(body: string | null): string | null {
  if (body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const error = 'error' in parsed ? parsed.error : undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    if (typeof error.message === 'string') return error.message;
  }
  return 'message' in parsed && typeof parsed.message === 'string' ? parsed.message : null;
}

export function readableBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
