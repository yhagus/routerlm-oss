import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  HttpClient,
  HttpClientError,
  type HttpResponse,
  InjectHttpClient,
} from "@nestjs/http-client";
import { z } from "zod";
import { withoutTrailingSlash } from "@/libs/models/url.js";
import { codexCliHeaders } from "@/upstream/models/codex-cli-identity.js";
import {
  type DeviceAuthorization,
  type OauthLoginEndpoint,
  OauthLoginError,
  type PendingDeviceCode,
  type TokenPoll,
  type TokenRefresh,
} from "@/upstream/models/oauth-device-grant.js";
import { codexAccountOf, secondsUntilExpiryOf } from "@/upstream/models/openai-codex-tokens.js";
import type { OauthTokens } from "@/upstream/models/provider-account.js";
import type { OauthFlowLoginClient } from "./oauth-flow-login-client.js";
import { OAUTH_LOGIN_HTTP_CLIENT, REFRESH_RETRY } from "./oauth-login-http.js";

type OpenAiCodexEndpoint = Extract<OauthLoginEndpoint, { flow: "openai-codex" }>;

const USER_CODE_PATH = "/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_PATH = "/api/accounts/deviceauth/token";
const TOKEN_PATH = "/oauth/token";
const VERIFICATION_PATH = "/codex/device";
const CALLBACK_PATH = "/deviceauth/callback";
/** The Codex CLI gives up on a device code after 15 minutes; OpenAI states no expiry. */
const DEVICE_CODE_LIFETIME_SECONDS = 15 * 60;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
/** The refresh errors after which only a new sign-in helps (ADR 0013). */
const REFUSED_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
]);

const userCodeSchema = z.object({
  device_auth_id: z.string().min(1),
  user_code: z.string().min(1),
  // The CLI's own server sends it as a string of seconds.
  interval: z.coerce.number().positive().catch(DEFAULT_POLL_INTERVAL_SECONDS),
});

const authorizationCodeSchema = z.object({
  authorization_code: z.string().min(1),
  code_verifier: z.string().min(1),
});

const grantedTokensSchema = z.object({
  id_token: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

/** A refresh may leave out any token it does not rotate. */
const refreshedTokensSchema = z.object({
  id_token: z.string().min(1).optional(),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
});

/** OpenAI names a token error as a string, or as an object with a code. */
const tokenErrorSchema = z.object({
  error: z.union([z.string(), z.object({ code: z.string() }).transform((error) => error.code)]),
});

/**
 * OpenAI Codex's device-code sign-in as the Codex CLI runs it (`codex login
 * --device-auth`, ADR 0013), and the refresh of the login it grants. Not RFC
 * 8628: the device auth endpoints hand out an authorization code, which is
 * exchanged at the issuer's token endpoint. Written natively: Nest has no
 * first-party OAuth client (ADR 0001).
 */
@Injectable()
export class OpenAiCodexLoginClient implements OauthFlowLoginClient<OpenAiCodexEndpoint> {
  private readonly logger = new Logger(OpenAiCodexLoginClient.name);

  constructor(@InjectHttpClient(OAUTH_LOGIN_HTTP_CLIENT) private readonly http: HttpClient) {}

  /** Asks for a user code. Throws OauthLoginError, saying so when OpenAI has device login off. */
  async authorizeDevice(endpoint: OpenAiCodexEndpoint): Promise<DeviceAuthorization> {
    let answer: HttpResponse;
    try {
      answer = await this.postJson(endpoint, USER_CODE_PATH, { client_id: endpoint.clientId });
    } catch (error) {
      if (error instanceof HttpClientError) {
        throw new OauthLoginError(`The auth host could not be reached: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
    if (answer.status === HttpStatus.NOT_FOUND) {
      throw new OauthLoginError(
        "OpenAI has device code login turned off for this client (HTTP 404 on the user code request)",
      );
    }
    const parsed = userCodeSchema.safeParse(answer.data);
    if (!answer.ok || !parsed.success) {
      throw new OauthLoginError(`The auth host did not start a sign-in (HTTP ${answer.status})`, {
        cause: parsed.error,
      });
    }
    return {
      deviceCode: parsed.data.device_auth_id,
      userCode: parsed.data.user_code,
      verificationUri: `${withoutTrailingSlash(endpoint.issuer)}${VERIFICATION_PATH}`,
      verificationUriComplete: null,
      expiresInSeconds: DEVICE_CODE_LIFETIME_SECONDS,
      pollIntervalSeconds: parsed.data.interval,
    };
  }

  /**
   * Asks once whether the User has approved the code and, once they have,
   * exchanges the authorization code for tokens. Never throws for an HTTP
   * failure.
   */
  async pollToken(endpoint: OpenAiCodexEndpoint, pending: PendingDeviceCode): Promise<TokenPoll> {
    let answer: HttpResponse;
    try {
      answer = await this.postJson(endpoint, DEVICE_TOKEN_PATH, {
        device_auth_id: pending.deviceCode,
        user_code: pending.userCode,
      });
    } catch (error) {
      if (error instanceof HttpClientError) {
        return { kind: "unanswered", reason: error.message };
      }
      throw error;
    }
    // OpenAI answers 403 or 404 until the User approves.
    if (answer.status === HttpStatus.FORBIDDEN || answer.status === HttpStatus.NOT_FOUND) {
      return { kind: "pending" };
    }
    if (!answer.ok) {
      return isTransient(answer.status)
        ? { kind: "unanswered", reason: `HTTP ${answer.status}` }
        : { kind: "denied" };
    }
    const approved = authorizationCodeSchema.safeParse(answer.data);
    if (!approved.success) {
      return { kind: "unanswered", reason: "the approval carries no authorization code" };
    }
    return this.exchangeAuthorizationCode(endpoint, approved.data);
  }

  /**
   * Trades the refresh token for new tokens. Any token the issuer returns
   * replaces the stored one; refresh tokens rotate and are single use.
   * Never throws for an HTTP failure.
   */
  async refreshTokens(endpoint: OpenAiCodexEndpoint, refreshToken: string): Promise<TokenRefresh> {
    let answer: HttpResponse;
    try {
      answer = await this.http.post(`${withoutTrailingSlash(endpoint.issuer)}${TOKEN_PATH}`, {
        headers: { ...codexCliHeaders(endpoint.cliVersion), accept: "application/json" },
        json: {
          grant_type: "refresh_token",
          client_id: endpoint.clientId,
          refresh_token: refreshToken,
        },
        throwOnHttpError: false,
        retry: REFRESH_RETRY,
      });
    } catch (error) {
      if (error instanceof HttpClientError) {
        return { kind: "unanswered", reason: error.message };
      }
      throw error;
    }
    const refreshed = refreshedTokensSchema.safeParse(answer.data);
    if (answer.ok && refreshed.success) {
      const tokens = tokensOf({
        idToken: refreshed.data.id_token,
        accessToken: refreshed.data.access_token,
        refreshToken: refreshed.data.refresh_token ?? refreshToken,
      });
      return tokens
        ? { kind: "refreshed", tokens }
        : { kind: "unanswered", reason: "the access token states no expiry" };
    }
    const tokenError = tokenErrorSchema.safeParse(answer.data).data?.error;
    const isRefused =
      answer.status === HttpStatus.UNAUTHORIZED ||
      (tokenError !== undefined && REFUSED_REFRESH_ERRORS.has(tokenError));
    const reason = tokenError ? `HTTP ${answer.status}, ${tokenError}` : `HTTP ${answer.status}`;
    return { kind: isRefused ? "refused" : "unanswered", reason };
  }

  /**
   * The tokens for the approved sign-in. OpenAI no longer hands out the
   * authorization code once it did, so a failed exchange ends the sign-in.
   */
  private async exchangeAuthorizationCode(
    endpoint: OpenAiCodexEndpoint,
    approved: z.infer<typeof authorizationCodeSchema>,
  ): Promise<TokenPoll> {
    const issuer = withoutTrailingSlash(endpoint.issuer);
    let answer: HttpResponse;
    try {
      answer = await this.http.post(`${issuer}${TOKEN_PATH}`, {
        headers: { ...codexCliHeaders(endpoint.cliVersion), accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: endpoint.clientId,
          code: approved.authorization_code,
          redirect_uri: `${issuer}${CALLBACK_PATH}`,
          code_verifier: approved.code_verifier,
        }),
        throwOnHttpError: false,
        retry: false,
      });
    } catch (error) {
      if (error instanceof HttpClientError) {
        this.logger.warn(`The approved sign-in's code exchange got no answer: ${error.message}`);
        return { kind: "denied" };
      }
      throw error;
    }
    const granted = grantedTokensSchema.safeParse(answer.data);
    const tokens =
      answer.ok && granted.success
        ? tokensOf({
            idToken: granted.data.id_token,
            accessToken: granted.data.access_token,
            refreshToken: granted.data.refresh_token,
          })
        : null;
    if (tokens === null) {
      this.logger.warn(`The approved sign-in's code exchange failed (HTTP ${answer.status})`);
      return { kind: "denied" };
    }
    return { kind: "granted", tokens };
  }

  /** A JSON POST as the Codex CLI. A non-2xx answer is returned, not thrown. */
  private postJson(
    endpoint: OpenAiCodexEndpoint,
    path: string,
    json: Record<string, string>,
  ): Promise<HttpResponse> {
    return this.http.post(`${withoutTrailingSlash(endpoint.issuer)}${path}`, {
      headers: { ...codexCliHeaders(endpoint.cliVersion), accept: "application/json" },
      json,
      throwOnHttpError: false,
      retry: false,
    });
  }
}

/** 429 and 5xx say nothing about the sign-in: worth asking again. */
function isTransient(status: number): boolean {
  return status === HttpStatus.TOO_MANY_REQUESTS || status >= HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * The tokens as the gateway keeps them: the access token lasts until its
 * JWT `exp`. Null when it states none, since then nothing tells when to
 * refresh it.
 */
function tokensOf(granted: {
  idToken: string | undefined;
  accessToken: string;
  refreshToken: string;
}): OauthTokens | null {
  const expiresInSeconds = secondsUntilExpiryOf(granted.accessToken, new Date());
  if (expiresInSeconds === null) {
    return null;
  }
  const codexAccount = granted.idToken === undefined ? null : codexAccountOf(granted.idToken);
  return {
    accessToken: granted.accessToken,
    refreshToken: granted.refreshToken,
    expiresInSeconds,
    ...(codexAccount === null ? {} : { codexAccount }),
  };
}
