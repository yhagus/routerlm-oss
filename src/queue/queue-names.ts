/** Proves the backend-to-worker path; its job only reports which process ran it. */
export const PING_QUEUE = "ping";

/** One job per inference request, which the worker writes as a Usage Log and its Attempts. */
export const USAGE_QUEUE = "usage";

/** Repeating housekeeping of Error Captures: deleting the expired ones. */
export const ERROR_CAPTURES_QUEUE = "error-captures";

/** Every queue the backend enqueues to and the worker consumes. */
export const QUEUE_NAMES = [PING_QUEUE, USAGE_QUEUE, ERROR_CAPTURES_QUEUE] as const;
