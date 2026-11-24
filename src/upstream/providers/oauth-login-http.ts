import type { HttpRetryOptions } from "@nestjs/http-client";

export const OAUTH_LOGIN_HTTP_CLIENT = "oauth-login";
export const OAUTH_LOGIN_TIMEOUT_MS = 10_000;
export const REFRESH_RETRY = { attempts: 3, methods: ["POST"] } satisfies HttpRetryOptions;
