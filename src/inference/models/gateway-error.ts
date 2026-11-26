import type { ErrorOrigin, GatewayErrorCode } from "@/db/schemas";

export const GATEWAY_ERROR_STATUS = {
  invalid_request: 400,
  no_capable_route: 400,
  invalid_api_key: 401,
  spend_limit_reached: 402,
  model_not_allowed: 403,
  model_not_found: 404,
  request_too_large: 413,
  request_rate_exceeded: 429,
  upstream_rate_limited: 429,
  upstream_error: 502,
  upstream_timeout: 504,
  video_not_found: 404,
  video_not_ready: 409,
} as const satisfies Record<GatewayErrorCode, number>;

export class GatewayError extends Error {
  readonly status: number;

  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly origin: ErrorOrigin,
  ) {
    super(message);
    this.name = "GatewayError";
    this.status = GATEWAY_ERROR_STATUS[code];
  }
}
