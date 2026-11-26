import type { ErrorOrigin, RecordedAttemptFailure } from '@/db/schemas';
import type { Snapshot, SnapshotProviderAccount } from '@/snapshot/models/snapshot';
import type { UsageJob } from '@/usage/models/usage-job';
import { playgroundSummaryOf } from './playground-summary';

const HTTP_OK = 200;
const ERROR_MESSAGE_MAX_LENGTH = 500;

export interface ProbeResult {
  providerAccountId: string;
  providerAccountName: string;
  ok: boolean;
  latencyMs: number;
  upstreamStatus: number | null;
  failureReason: RecordedAttemptFailure | null;
  errorOrigin: ErrorOrigin | null;
  errorMessage: string | null;
  errorCaptureId: string | null;
  cost: number | null;
}

export interface ProbeResults {
  results: ProbeResult[];
}

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
