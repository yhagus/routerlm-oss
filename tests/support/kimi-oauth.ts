import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { type OauthRegion, providerAccounts, providers } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { storedOauthTokens } from "@/upstream/models/provider-account.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import type { FakeReply } from "./fake-upstream.js";

// The fake upstream plays Kimi's auth host and its `/me`: these are the
// paths the gateway calls and the answers Kimi gives (spec #28, "OAuth Login").

export const DEVICE_AUTHORIZATION_PATH = "/api/oauth/device_authorization";
export const TOKEN_PATH = "/api/oauth/token";
/** Relative to the fake upstream's origin: its base URL ends in `/v1`. */
export const PROFILE_PATH = "/v1/me";

export const DEVICE_CODE = "device-code-0123456789";
export const USER_CODE = "WDJB-MJHT";
export const ACCESS_TOKEN = "kimi-access-token-0123456789";
export const REFRESH_TOKEN = "kimi-refresh-token-9876543210";

/** Starts a sign-in whose code lasts `expiresIn` seconds and is polled every `interval` seconds. */
export function deviceAuthorizationReply(timing: {
  expiresIn: number;
  interval?: number;
}): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      device_code: DEVICE_CODE,
      user_code: USER_CODE,
      verification_uri: "https://www.kimi.com/code/authorize",
      verification_uri_complete: `https://www.kimi.com/code/authorize?user_code=${USER_CODE}`,
      expires_in: timing.expiresIn,
      interval: timing.interval,
    },
  };
}

/** What the token endpoint answers until the User approves, and how it refuses. */
export function tokenErrorReply(
  error: "authorization_pending" | "slow_down" | "access_denied" | "expired_token",
): FakeReply {
  return { kind: "json", status: 400, body: { error } };
}

/** The User approved: the tokens, held back `delayMs` when given. */
export function grantedTokensReply(delayMs?: number): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
      token_type: "Bearer",
    },
    delayMs,
  };
}

export function profileReply(profile: {
  nickname?: string;
  email?: string;
  user_level_name?: string;
}): FakeReply {
  return { kind: "json", status: 200, body: profile };
}

export const DEVICE_ID = "device-id-0123456789abcdef";
export const CLIENT_ID = "client-id-of-the-cli";
export const CLI_VERSION = "9.8.7";

/** What the token endpoint answers to a refresh: new tokens, the refresh token rotated. */
export function refreshedTokensReply(
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  delayMs?: number,
): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      token_type: "Bearer",
    },
    delayMs,
  };
}

/** Makes a Provider offer OAuth Login at auth hosts the fake upstream plays, under `/global` and `/china`. */
export async function offerOauthLogin(
  db: Database,
  providerId: string,
  authOrigin: string,
): Promise<void> {
  await db
    .update(providers)
    .set({
      oauthLogin: {
        authHosts: { global: `${authOrigin}/global`, china: `${authOrigin}/china` },
        clientId: CLIENT_ID,
        cliVersion: CLI_VERSION,
      },
    })
    .where(eq(providers.id, providerId));
}

export interface InsertedOauthLogin {
  /** How long the access token lasted when it was granted. */
  lifetimeSeconds: number;
  /** How long ago it was granted; just now when not given. */
  ageSeconds?: number;
  accessToken?: string;
  refreshToken?: string;
  region?: OauthRegion;
  /** Before every other account of the Provider when not given. */
  priority?: number;
}

/**
 * Adds a Provider Account holding an OAuth Login, as a completed sign-in
 * leaves it, then refreshes the snapshot. Returns its id.
 */
export async function addOauthLoginAccount(
  app: NestNodeApplication,
  db: Database,
  providerId: string,
  login: InsertedOauthLogin,
): Promise<string> {
  const grantedAt = new Date(Date.now() - (login.ageSeconds ?? 0) * 1000);
  const [providerAccount] = await db
    .insert(providerAccounts)
    .values({
      providerId,
      name: "signed in",
      credentialKind: "oauth-login",
      ...storedOauthTokens(
        app.get(ProviderKeyCipher),
        {
          accessToken: login.accessToken ?? ACCESS_TOKEN,
          refreshToken: login.refreshToken ?? REFRESH_TOKEN,
          expiresInSeconds: login.lifetimeSeconds,
        },
        grantedAt,
      ),
      oauthRegion: login.region ?? "global",
      oauthDeviceId: DEVICE_ID,
      priority: login.priority ?? -1,
    })
    .returning({ id: providerAccounts.id });
  await app.get(SnapshotService).changed();
  return providerAccount.id;
}
