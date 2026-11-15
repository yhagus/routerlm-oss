import type { AttemptFailureReason } from "@/db/schemas/index.js";
import { GatewayError } from "./gateway-error.js";

/** What the upstream sent back on a failed Attempt, for Error Captures. Never sent to the client. */
export interface UpstreamFailureResponse {
  headers: Record<string, string>;
  body: string;
}

/**
 * One Attempt failed. `reason` is the Fallback table's row (spec "Fallback"):
 * Fallback (#12) decides from it whether to try the next Provider Account.
 */
export class AttemptFailedError extends Error {
  constructor(
    readonly reason: AttemptFailureReason,
    /** Null when no response arrived (timeout, connection error). */
    readonly upstreamStatus: number | null,
    message: string,
    readonly upstreamResponse: UpstreamFailureResponse | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AttemptFailedError";
  }

  /** The upstream's `Retry-After` header, for Cooldown; null when absent. */
  get retryAfter(): string | null {
    return this.upstreamResponse?.headers["retry-after"] ?? null;
  }
}

/** The client went away; nothing is sent back. */
export class ClientCancelledError extends Error {
  constructor() {
    super("The client disconnected");
    this.name = "ClientCancelledError";
  }
}

const FAILURE_MESSAGES = {
  rate_limited: [
    "upstream_rate_limited",
    "The upstream is rate limiting requests; try again later",
  ],
  timeout: ["upstream_timeout", "The upstream did not answer in time"],
  bad_request: ["invalid_request", "The upstream refused the request as invalid"],
  server_error: ["upstream_error", "The upstream failed to answer"],
  connection_error: ["upstream_error", "The upstream could not be reached"],
  unauthorized: ["upstream_error", "The upstream failed to answer"],
  stream_interrupted: ["upstream_error", "The upstream stream broke off"],
  exhausted: ["upstream_rate_limited", "The upstream's usage quota is used up; try again later"],
} as const satisfies Record<AttemptFailureReason, readonly [GatewayError["code"], string]>;

/**
 * What the client is told when the request's last Attempt failed this way.
 * Our own words only: upstream error text is never forwarded.
 */
export function gatewayErrorFor(failure: AttemptFailedError): GatewayError {
  const [code, message] = FAILURE_MESSAGES[failure.reason];
  return new GatewayError(code, message);
}

/**
 * What the client is told when Fallback ran out of Attempts (spec "Error
 * contract"): 429 if every Attempt was rate limited, 504 if every one timed
 * out, otherwise 502. With no Attempt at all, `cooldownCauses` decides: what
 * put each enabled Provider Account of the capable Routes in Cooldown (null
 * when one is not in Cooldown). 429 when they are all rate limited, else 502.
 */
export function exhaustionError(
  failures: AttemptFailedError[],
  cooldownCauses: (AttemptFailureReason | null)[],
): GatewayError {
  const [firstFailure] = failures;
  if (!firstFailure) {
    const isEveryAccountRateLimited =
      cooldownCauses.length > 0 && cooldownCauses.every((cause) => cause === "rate_limited");
    return isEveryAccountRateLimited
      ? new GatewayError(...FAILURE_MESSAGES.rate_limited)
      : new GatewayError("upstream_error", "No upstream is available for this Model");
  }
  const failedTheSameWay = failures.every((failure) => failure.reason === firstFailure.reason);
  if (failedTheSameWay) {
    return gatewayErrorFor(firstFailure);
  }
  return new GatewayError("upstream_error", "The upstream failed to answer");
}
