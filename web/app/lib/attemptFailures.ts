export const RECORDED_ATTEMPT_FAILURES = [
  'rate_limited',
  'server_error',
  'timeout',
  'connection_error',
  'unauthorized',
  'bad_request',
  'stream_interrupted',
  'exhausted',
  'not_in_plan',
  'cancelled',
] as const;
export type RecordedAttemptFailure = (typeof RECORDED_ATTEMPT_FAILURES)[number];
