const UPSTREAM_REQUEST_ID_HEADERS = ['x-request-id', 'request-id'] as const;

export function upstreamRequestIdOf(headers: Record<string, string>): string | null {
  for (const name of UPSTREAM_REQUEST_ID_HEADERS) {
    const requestId = headers[name];
    if (requestId) {
      return requestId;
    }
  }
  return null;
}
