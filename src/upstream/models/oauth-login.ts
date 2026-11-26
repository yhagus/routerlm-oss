const MIN_REFRESH_MARGIN_MS = 300_000;

export const SIGN_IN_AGAIN_REASON =
  'Sign in again: the Provider no longer accepts this OAuth Login';

export interface OauthLoginLifetime {
  grantedAt: Date | null;
  expiresAt: Date;
}

export function needsRefresh({ grantedAt, expiresAt }: OauthLoginLifetime, now: Date): boolean {
  const remainingMs = expiresAt.getTime() - now.getTime();
  const lifetimeMs = grantedAt ? expiresAt.getTime() - grantedAt.getTime() : 0;
  return remainingMs < Math.max(MIN_REFRESH_MARGIN_MS, lifetimeMs / 2);
}
