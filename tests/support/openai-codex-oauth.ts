import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { codexAccountOf, secondsUntilExpiryOf } from "@/upstream/models/openai-codex-tokens.js";
import { storedOauthTokens } from "@/upstream/models/provider-account.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import type { FakeReply } from "./fake-upstream.js";

// The fake upstream plays OpenAI's auth host under `/auth`: these are the
// paths the Codex CLI calls and the answers OpenAI gives (spec #35, "OAuth Login").

export const ISSUER_PATH = "/auth";
export const USER_CODE_PATH = `${ISSUER_PATH}/api/accounts/deviceauth/usercode`;
export const DEVICE_TOKEN_PATH = `${ISSUER_PATH}/api/accounts/deviceauth/token`;
export const TOKEN_PATH = `${ISSUER_PATH}/oauth/token`;

export const CLIENT_ID = "app_codex-client-id";
export const CLI_VERSION = "0.169.0";
export const DEVICE_AUTH_ID = "deviceauth_0123456789";
export const USER_CODE = "ABCD-1234";
export const AUTHORIZATION_CODE = "authorization-code-0123";
export const CODE_VERIFIER = "code-verifier-0123456789";
export const ACCOUNT_ID = "chatgpt-account-0123";
export const EMAIL = "ada@example.com";
export const PLAN_TYPE = "pro";

/** An unsigned JWT with these claims, as the gateway reads it: the signature is never checked. */
export function jwtWith(claims: Record<string, unknown>): string {
  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.signature`;
}

/** An access token that runs out `lifetimeSeconds` from now; `label` tells tokens apart. */
export function accessToken(label: string, lifetimeSeconds: number): string {
  return jwtWith({ label, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds });
}

/** An id_token naming a ChatGPT account, its email and plan, where OpenAI puts them. */
export function idToken(
  account: { accountId?: string; email?: string; planType?: string; profileEmail?: string } = {},
): string {
  return jwtWith({
    ...(account.email === undefined ? {} : { email: account.email }),
    ...(account.profileEmail === undefined
      ? {}
      : { "https://api.openai.com/profile": { email: account.profileEmail } }),
    "https://api.openai.com/auth": {
      chatgpt_account_id: account.accountId ?? ACCOUNT_ID,
      chatgpt_plan_type: account.planType ?? PLAN_TYPE,
    },
  });
}

export function userCodeReply(interval = "5"): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: { device_auth_id: DEVICE_AUTH_ID, user_code: USER_CODE, interval },
  };
}

/** What the device token endpoint answers until the User approves. */
export const PENDING_REPLY: FakeReply = {
  kind: "json",
  status: 403,
  body: { error: { message: "Device authorization is pending" } },
};

export const APPROVED_REPLY: FakeReply = {
  kind: "json",
  status: 200,
  body: {
    authorization_code: AUTHORIZATION_CODE,
    code_challenge: "code-challenge",
    code_verifier: CODE_VERIFIER,
  },
};

/** The tokens the issuer's token endpoint grants or refreshes to. Leave out what a refresh doesn't rotate. */
export function tokensReply(tokens: {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
}): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      access_token: tokens.accessToken,
      ...(tokens.refreshToken === undefined ? {} : { refresh_token: tokens.refreshToken }),
      ...(tokens.idToken === undefined ? {} : { id_token: tokens.idToken }),
    },
  };
}

/** Makes a Provider sign in as the Codex CLI at the fake upstream's `/auth`. */
export async function offerCodexOauthLogin(
  db: Database,
  providerId: string,
  origin: string,
): Promise<void> {
  await db
    .update(providers)
    .set({
      oauthLogin: {
        flow: "openai-codex",
        issuer: `${origin}${ISSUER_PATH}`,
        clientId: CLIENT_ID,
        cliVersion: CLI_VERSION,
      },
    })
    .where(eq(providers.id, providerId));
}

export interface InsertedCodexLogin {
  accessToken: string;
  refreshToken: string;
  /** Before every other account of the Provider when not given. */
  priority?: number;
}

/**
 * Adds a Provider Account holding an OpenAI Codex OAuth Login, as a
 * completed sign-in leaves it, then refreshes the snapshot. Returns its id.
 */
export async function addCodexLoginAccount(
  app: NestNodeApplication,
  db: Database,
  providerId: string,
  login: InsertedCodexLogin,
): Promise<string> {
  const now = new Date();
  const codexAccount = codexAccountOf(idToken());
  const [providerAccount] = await db
    .insert(providerAccounts)
    .values({
      providerId,
      name: "signed in",
      credentialKind: "oauth-login",
      ...storedOauthTokens(
        app.get(ProviderKeyCipher),
        {
          accessToken: login.accessToken,
          refreshToken: login.refreshToken,
          expiresInSeconds: secondsUntilExpiryOf(login.accessToken, now) ?? 0,
          ...(codexAccount === null ? {} : { codexAccount }),
        },
        now,
      ),
      oauthDeviceId: "device-id-of-the-account",
      priority: login.priority ?? -1,
    })
    .returning({ id: providerAccounts.id });
  await app.get(SnapshotService).changed();
  return providerAccount.id;
}
