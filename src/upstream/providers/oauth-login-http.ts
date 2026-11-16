import type { HttpRetryOptions } from "@nestjs/http-client";

/** The HTTP client for a Provider's auth host and profile; each request carries its full URL. */
export const OAUTH_LOGIN_HTTP_CLIENT = "oauth-login";
export const OAUTH_LOGIN_TIMEOUT_MS = 10_000;
// A refresh is retried on the client's defaults (connection errors, timeouts,
// 429 and 5xx, with backoff), which leave out POST.
export const REFRESH_RETRY = { attempts: 3, methods: ["POST"] } satisfies HttpRetryOptions;
