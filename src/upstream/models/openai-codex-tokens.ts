import { z } from "zod";
import { SECOND_MS } from "@/libs/models/duration.js";

const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const OPENAI_PROFILE_CLAIM = "https://api.openai.com/profile";

/** Who signed in to OpenAI Codex, as the id_token's claims say (ADR 0013). */
export interface CodexAccount {
  idToken: string;
  /** Sent as `chatgpt-account-id` on every call to Codex; null when the token names none. */
  accountId: string | null;
  email: string | null;
  /** The ChatGPT plan, such as `plus` or `pro`. */
  planType: string | null;
}

const idTokenClaimsSchema = z.object({
  email: z.string().nullish(),
  [OPENAI_PROFILE_CLAIM]: z.object({ email: z.string().nullish() }).nullish(),
  [OPENAI_AUTH_CLAIM]: z
    .object({
      chatgpt_account_id: z.string().nullish(),
      chatgpt_plan_type: z.string().nullish(),
    })
    .nullish(),
});

const accessTokenClaimsSchema = z.object({ exp: z.number() });

/**
 * The claims of a JWT, read without checking its signature, as the Codex
 * CLI does: the gateway only learns from them, it never trusts them for
 * access. Null for a token that is not a JWT.
 */
function jwtClaimsOf(token: string): unknown {
  const [, payload] = token.split(".");
  if (payload === undefined) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** The account an id_token names. Null when it is not a JWT of the expected shape. */
export function codexAccountOf(idToken: string): CodexAccount | null {
  const claims = idTokenClaimsSchema.safeParse(jwtClaimsOf(idToken));
  if (!claims.success) {
    return null;
  }
  const auth = claims.data[OPENAI_AUTH_CLAIM];
  return {
    idToken,
    accountId: auth?.chatgpt_account_id ?? null,
    email: claims.data.email ?? claims.data[OPENAI_PROFILE_CLAIM]?.email ?? null,
    planType: auth?.chatgpt_plan_type ?? null,
  };
}

/** How long an access token has left by its JWT `exp`, from `now`. Null when it states no expiry. */
export function secondsUntilExpiryOf(accessToken: string, now: Date): number | null {
  const claims = accessTokenClaimsSchema.safeParse(jwtClaimsOf(accessToken));
  if (!claims.success) {
    return null;
  }
  return Math.max(claims.data.exp - now.getTime() / SECOND_MS, 0);
}
