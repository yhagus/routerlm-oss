/**
 * The response headers a Provider names its request id in, the one its
 * support asks for. Checked in order; the first present wins. OpenAI and the
 * OpenAI-compatible Providers send `x-request-id`, Anthropic `request-id`.
 */
const UPSTREAM_REQUEST_ID_HEADERS = ["x-request-id", "request-id"] as const;

/** `headers` with lower-case names, as `Headers.entries()` gives them; null when none names a request id. */
export function upstreamRequestIdOf(headers: Record<string, string>): string | null {
  for (const name of UPSTREAM_REQUEST_ID_HEADERS) {
    const requestId = headers[name];
    if (requestId) {
      return requestId;
    }
  }
  return null;
}
