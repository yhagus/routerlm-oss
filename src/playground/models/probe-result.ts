import type { ErrorOrigin, RecordedAttemptFailure } from "@/db/schemas/index.js";
import type { Snapshot, SnapshotProviderAccount } from "@/snapshot/models/snapshot.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { playgroundSummaryOf } from "./playground-summary.js";

const HTTP_OK = 200;
/** The upstream's error text is cut here: enough to read, short enough for a table cell. */
const ERROR_MESSAGE_MAX_LENGTH = 500;

/**
 * How a Probe call with one Provider Account went (GLOSSARY "Probe"). It
 * holds no prompt or response content (ADR 0004); the upstream's error text
 * is redacted of credentials as in its Error Capture.
 */
export interface ProbeResult {
  providerAccountId: string;
  providerAccountName: string;
  /** The upstream answered 2xx with a well-formed response for the Kind. */
  ok: boolean;
  latencyMs: number;
  /** Null when no response arrived (a timeout, a connection error) or no Attempt was made. */
  upstreamStatus: number | null;
  /** Why the call's last Attempt failed; null on success, or when it never reached the upstream. */
  failureReason: RecordedAttemptFailure | null;
  /** Null on success. */
  errorOrigin: ErrorOrigin | null;
  /** The upstream's error body, truncated; null with no error response. */
  errorMessage: string | null;
  /** The call's Error Capture; null on success. The worker writes it shortly after the answer. */
  errorCaptureId: string | null;
  /** USD; null on failure, or when the Upstream Model's prices are unknown. */
  cost: number | null;
}

/** The Probe's answer: one result per enabled Provider Account, in priority order. */
export interface ProbeResults {
  results: ProbeResult[];
}

/** The result of one Probe call, read from the usage job it recorded. */
export function probeResultOf(
  job: UsageJob,
  providerAccount: SnapshotProviderAccount,
  snapshot: Snapshot,
): ProbeResult {
  const isOk = job.httpStatus === HTTP_OK;
  const lastAttempt = job.attempts.at(-1);
  const lastFailedAttempt = job.errorCapture?.failedAttempts.at(-1);
  const errorBody = lastFailedAttempt?.upstreamResponse?.body ?? null;
  return {
    providerAccountId: providerAccount.id,
    providerAccountName: providerAccount.name,
    ok: isOk,
    latencyMs: job.durationMs,
    upstreamStatus: lastAttempt?.upstreamStatus ?? null,
    failureReason: lastAttempt?.failureReason ?? null,
    errorOrigin: job.errorOrigin ?? null,
    errorMessage: errorBody === null ? null : errorBody.slice(0, ERROR_MESSAGE_MAX_LENGTH),
    errorCaptureId: lastFailedAttempt?.captureId ?? job.errorCapture?.requestCaptureId ?? null,
    cost: isOk ? playgroundSummaryOf(job, snapshot).cost : null,
  };
}
