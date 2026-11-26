import { z } from 'zod';
import { SECOND_MS } from '@/libs/models/duration';

const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';
const OPENAI_PROFILE_CLAIM = 'https://api.openai.com/profile';

export interface CodexAccount {
  idToken: string;
  accountId: string | null;
  email: string | null;
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

function jwtClaimsOf(token: string): unknown {
  const [, payload] = token.split('.');
  if (payload === undefined) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

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

export function secondsUntilExpiryOf(accessToken: string, now: Date): number | null {
  const claims = accessTokenClaimsSchema.safeParse(jwtClaimsOf(accessToken));
  if (!claims.success) {
    return null;
  }
  return Math.max(claims.data.exp - now.getTime() / SECOND_MS, 0);
}
