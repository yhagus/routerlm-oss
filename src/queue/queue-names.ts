/** Proves the backend-to-worker path; its job only reports which process ran it. */
export const PING_QUEUE = "ping";

/** Every queue the backend enqueues to and the worker consumes. */
export const QUEUE_NAMES = [PING_QUEUE] as const;
