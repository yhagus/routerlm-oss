import { HttpStatus, Injectable } from "@nestjs/common";
import {
  HttpClient,
  HttpClientError,
  type HttpResponse,
  type HttpRetryOptions,
  InjectHttpClient,
} from "@nestjs/http-client";
import { z } from "zod";
import { withoutTrailingSlash } from "@/libs/models/url.js";
import { cliIdentityHeaders } from "../models/cli-identity.js";
import type {
  DeviceAuthorization,
  OauthLoginEndpoint,
  OauthProfile,
  TokenPoll,
  TokenRefresh,
} from "../models/oauth-device-grant.js";
import type { OauthTokens } from "../models/provider-account.js";

/** The HTTP client for a Provider's auth host and profile; each request carries its full URL. */
export const OAUTH_LOGIN_HTTP_CLIENT = "oauth-login";
export const OAUTH_LOGIN_TIMEOUT_MS = 10_000;

const DEVICE_AUTHORIZATION_PATH = "/api/oauth/device_authorization";
const TOKEN_PATH = "/api/oauth/token";
const PROFILE_PATH = "me";
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_GRANT_TYPE = "refresh_token";
/** The token error (RFC 6749, section 5.2) of a refresh token that is no longer valid. */
const INVALID_GRANT = "invalid_grant";
// A refresh is retried on the client's defaults (connection errors, timeouts,
// 429 and 5xx, with backoff), which leave out POST.
const REFRESH_RETRY = { attempts: 3, methods: ["POST"] } satisfies HttpRetryOptions;
/** RFC 8628: what a client waits between polls when the auth host names no interval. */
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
// The dashboard shows it as a link, so it must not be a `javascript:` URL.
const webLinkSchema = z.url({ protocol: /^https?$/ });

const deviceAuthorizationSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: webLinkSchema,
  verification_uri_complete: webLinkSchema.nullish(),
  expires_in: z.number().positive(),
  interval: z.number().positive().default(DEFAULT_POLL_INTERVAL_SECONDS),
});

const grantedTokensSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().positive(),
  })
  .transform((granted): OauthTokens => ({
    accessToken: granted.access_token,
    refreshToken: granted.refresh_token,
    expiresInSeconds: granted.expires_in,
  }));

const tokenErrorSchema = z.object({ error: z.string() });

const profileSchema = z.object({
  nickname: z.string().nullish(),
  email: z.string().nullish(),
  user_level_name: z.string().nullish(),
});

/** The auth host refused to start a sign-in, or could not be reached. */
export class OauthLoginError extends Error {}

/**
 * The OAuth device-code grant (RFC 8628) against a Provider's auth host,
 * written natively: Nest has no first-party OAuth client (ADR 0001). Which
 * host, client id and CLI version is Provider data; nothing here names a host.
 */
@Injectable()
export class OauthLoginClient {
  constructor(@InjectHttpClient(OAUTH_LOGIN_HTTP_CLIENT) private readonly http: HttpClient) {}

  /** Asks for a device code and the user code that goes with it. Throws OauthLoginError. */
  async authorizeDevice(endpoint: OauthLoginEndpoint): Promise<DeviceAuthorization> {
    let answer: HttpResponse;
    try {
      answer = await this.postForm(endpoint, DEVICE_AUTHORIZATION_PATH, {});
    } catch (error) {
      if (error instanceof HttpClientError) {
        throw new OauthLoginError(`The auth host could not be reached: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
    const parsed = deviceAuthorizationSchema.safeParse(answer.data);
    if (!answer.ok || !parsed.success) {
      throw new OauthLoginError(`The auth host did not start a sign-in (HTTP ${answer.status})`, {
        cause: parsed.error,
      });
    }
    return {
      deviceCode: parsed.data.device_code,
      userCode: parsed.data.user_code,
      verificationUri: parsed.data.verification_uri,
      verificationUriComplete: parsed.data.verification_uri_complete ?? null,
      expiresInSeconds: parsed.data.expires_in,
      pollIntervalSeconds: parsed.data.interval,
    };
  }

  /** Asks once whether the User has approved the device code. Never throws for an HTTP failure. */
  async pollToken(endpoint: OauthLoginEndpoint, deviceCode: string): Promise<TokenPoll> {
    let answer: HttpResponse;
    try {
      answer = await this.postForm(endpoint, TOKEN_PATH, {
        device_code: deviceCode,
        grant_type: DEVICE_CODE_GRANT_TYPE,
      });
    } catch (error) {
      if (error instanceof HttpClientError) {
        return { kind: "unanswered", reason: error.message };
      }
      throw error;
    }
    const granted = grantedTokensSchema.safeParse(answer.data);
    if (answer.ok && granted.success) {
      return { kind: "granted", tokens: granted.data };
    }
    const refusal = tokenErrorSchema.safeParse(answer.data);
    switch (refusal.data?.error) {
      case "authorization_pending":
        return { kind: "pending" };
      case "slow_down":
        return { kind: "slow-down" };
      case "access_denied":
        return { kind: "denied" };
      case "expired_token":
        return { kind: "expired" };
      default:
        return { kind: "unanswered", reason: `HTTP ${answer.status}` };
    }
  }

  /**
   * Trades the refresh token for new tokens; the refresh token it returns
   * replaces the one sent. Never throws for an HTTP failure.
   */
  async refreshTokens(endpoint: OauthLoginEndpoint, refreshToken: string): Promise<TokenRefresh> {
    let answer: HttpResponse;
    try {
      answer = await this.postForm(
        endpoint,
        TOKEN_PATH,
        { grant_type: REFRESH_GRANT_TYPE, refresh_token: refreshToken },
        REFRESH_RETRY,
      );
    } catch (error) {
      if (error instanceof HttpClientError) {
        return { kind: "unanswered", reason: error.message };
      }
      throw error;
    }
    const granted = grantedTokensSchema.safeParse(answer.data);
    if (answer.ok && granted.success) {
      return { kind: "refreshed", tokens: granted.data };
    }
    const tokenError = tokenErrorSchema.safeParse(answer.data).data?.error;
    const isRefused =
      answer.status === HttpStatus.UNAUTHORIZED ||
      answer.status === HttpStatus.FORBIDDEN ||
      tokenError === INVALID_GRANT;
    const reason = tokenError ? `HTTP ${answer.status}, ${tokenError}` : `HTTP ${answer.status}`;
    return { kind: isRefused ? "refused" : "unanswered", reason };
  }

  /**
   * Who the access token belongs to, from `GET <base URL>/me`. Like the quota
   * endpoint, it takes no identity header besides `Authorization`. Null when
   * the Provider doesn't answer: a sign-in is worth keeping without a name.
   */
  async readProfile(baseUrl: string, accessToken: string): Promise<OauthProfile | null> {
    try {
      const response = await this.http.get(`${withoutTrailingSlash(baseUrl)}/${PROFILE_PATH}`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
      const profile = profileSchema.safeParse(response.data);
      if (!profile.success) {
        return null;
      }
      return {
        nickname: profile.data.nickname ?? null,
        email: profile.data.email ?? null,
        levelName: profile.data.user_level_name ?? null,
      };
    } catch (error) {
      if (error instanceof HttpClientError) {
        return null;
      }
      throw error;
    }
  }

  /** A form-encoded POST as the Provider's CLI. A non-2xx answer is returned, not thrown. */
  private postForm(
    { authHost, clientId, identity }: OauthLoginEndpoint,
    path: string,
    fields: Record<string, string>,
    retry: HttpRetryOptions | false = false,
  ): Promise<HttpResponse> {
    return this.http.post(`${withoutTrailingSlash(authHost)}${path}`, {
      headers: { ...cliIdentityHeaders(identity), accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId, ...fields }),
      throwOnHttpError: false,
      retry,
    });
  }
}
