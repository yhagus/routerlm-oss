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
import { cliIdentityHeaders } from "@/upstream/models/cli-identity.js";
import {
  type DeviceAuthorization,
  type OauthLoginEndpoint,
  OauthLoginError,
  type OauthProfile,
  type PendingDeviceCode,
  type TokenPoll,
  type TokenRefresh,
} from "@/upstream/models/oauth-device-grant.js";
import type { OauthTokens } from "@/upstream/models/provider-account.js";
import type { OauthFlowLoginClient } from "./oauth-flow-login-client.js";
import { OAUTH_LOGIN_HTTP_CLIENT, REFRESH_RETRY } from "./oauth-login-http.js";

type KimiCodeEndpoint = Extract<OauthLoginEndpoint, { flow: "kimi-code" }>;

const DEVICE_AUTHORIZATION_PATH = "/api/oauth/device_authorization";
const TOKEN_PATH = "/api/oauth/token";
const PROFILE_PATH = "me";
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_GRANT_TYPE = "refresh_token";
const INVALID_GRANT = "invalid_grant";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
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

@Injectable()
export class KimiCodeLoginClient implements OauthFlowLoginClient<KimiCodeEndpoint> {
  constructor(@InjectHttpClient(OAUTH_LOGIN_HTTP_CLIENT) private readonly http: HttpClient) {}

  async authorizeDevice(endpoint: KimiCodeEndpoint): Promise<DeviceAuthorization> {
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

  async pollToken(endpoint: KimiCodeEndpoint, pending: PendingDeviceCode): Promise<TokenPoll> {
    let answer: HttpResponse;
    try {
      answer = await this.postForm(endpoint, TOKEN_PATH, {
        device_code: pending.deviceCode,
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

  async refreshTokens(endpoint: KimiCodeEndpoint, refreshToken: string): Promise<TokenRefresh> {
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

  private postForm(
    { authHost, clientId, identity }: KimiCodeEndpoint,
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
