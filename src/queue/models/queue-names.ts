/** Proves the backend-to-worker path; its job only reports which process ran it. */
export const PING_QUEUE = "ping";

/** One job per inference request, which the worker writes as a Usage Log and its Attempts. */
export const USAGE_QUEUE = "usage";

/** Repeating housekeeping of Error Captures: deleting the expired ones. */
export const ERROR_CAPTURES_QUEUE = "error-captures";

/** Repeating Quota Meter readings of the Provider Accounts that are due one. */
export const QUOTA_METERS_QUEUE = "quota-meters";

/**
 * One delayed job per poll of a pending OAuth Login sign-in. UpstreamModule
 * registers it itself, as both the backend and the worker enqueue to it.
 */
export const OAUTH_SIGN_INS_QUEUE = "oauth-sign-ins";

/** Every queue the backend enqueues to and the worker consumes, but for OAUTH_SIGN_INS_QUEUE. */
export const QUEUE_NAMES = [
  PING_QUEUE,
  USAGE_QUEUE,
  ERROR_CAPTURES_QUEUE,
  QUOTA_METERS_QUEUE,
] as const;
