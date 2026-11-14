import { createError, defineEventHandler, getRequestURL, proxyRequest } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";

const DASHBOARD_API_PATH = "/api/";

// The browser only talks to this app, so the backend's session cookie is
// first-party. Every /api/** call is forwarded to the backend's dashboard API
// at the same path, with the browser's Cookie and Origin; the backend's
// Set-Cookie comes back unchanged.
export default defineEventHandler((event) => {
  const { pathname, search } = getRequestURL(event);
  // A normalised path such as /api/../v1 must not reach the rest of the backend.
  if (!pathname.startsWith(DASHBOARD_API_PATH)) {
    throw createError({ statusCode: 404 });
  }
  const { backendUrl } = useRuntimeConfig(event);
  // proxyRequest streams the backend's body chunk by chunk (Playground answers
  // arrive as they are generated). When the browser leaves early (Stop), the
  // backend call is aborted too, which ends the upstream call.
  const backendCall = new AbortController();
  const { res } = event.node;
  res.once("close", () => {
    if (!res.writableFinished) backendCall.abort();
  });
  return proxyRequest(event, new URL(`${pathname}${search}`, backendUrl).toString(), {
    fetchOptions: { signal: backendCall.signal },
  });
});
