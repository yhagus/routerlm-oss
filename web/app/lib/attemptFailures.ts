/**
 * Why a recorded Attempt failed: a Fallback reason, or "cancelled" when the
 * client went away during it, as the backend's `RECORDED_ATTEMPT_FAILURES` says.
 */
export const RECORDED_ATTEMPT_FAILURES = [
  "rate_limited",
  "server_error",
  "timeout",
  "connection_error",
  "unauthorized",
  "bad_request",
  "stream_interrupted",
  "exhausted",
  "cancelled",
] as const;
export type RecordedAttemptFailure = (typeof RECORDED_ATTEMPT_FAILURES)[number];
