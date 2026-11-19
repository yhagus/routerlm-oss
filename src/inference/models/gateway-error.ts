import type { GatewayErrorCode } from "@/db/schemas/index.js";

/** The HTTP status of each error contract code (spec "Error contract"). */
export const GATEWAY_ERROR_STATUS = {
  invalid_request: 400,
  no_capable_route: 400,
  invalid_api_key: 401,
  model_not_allowed: 403,
  model_not_found: 404,
  request_too_large: 413,
  upstream_rate_limited: 429,
  upstream_error: 502,
  upstream_timeout: 504,
  video_not_found: 404,
  video_not_ready: 409,
} as const satisfies Record<GatewayErrorCode, number>;

/**
 * An inference failure the client is told about. Its message is ours and safe
 * to send: it never carries upstream error text, keys or prompt content. The
 * client Protocol's converter writes it in that Protocol's envelope.
 */
export class GatewayError extends Error {
  readonly status: number;

  constructor(
    readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
    this.status = GATEWAY_ERROR_STATUS[code];
  }
}
