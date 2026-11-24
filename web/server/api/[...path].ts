import { createError, defineEventHandler, getRequestURL, proxyRequest } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";

const DASHBOARD_API_PATH = "/api/";

export default defineEventHandler((event) => {
  const { pathname, search } = getRequestURL(event);
  if (!pathname.startsWith(DASHBOARD_API_PATH)) {
    throw createError({ statusCode: 404 });
  }
  const { backendUrl } = useRuntimeConfig(event);
  const backendCall = new AbortController();
  const { res } = event.node;
  res.once("close", () => {
    if (!res.writableFinished) backendCall.abort();
  });
  return proxyRequest(event, new URL(`${pathname}${search}`, backendUrl).toString(), {
    fetchOptions: { signal: backendCall.signal },
  });
});
