/** Every OAuth Login is refreshed in its last 300 seconds, however short its lifetime. */
const MIN_REFRESH_MARGIN_MS = 300_000;

/**
 * Why the gateway disabled a Provider Account whose OAuth Login the Provider
 * no longer accepts. Any Provider Account the gateway disabled while it held
 * an OAuth Login needs a new sign-in.
 */
export const SIGN_IN_AGAIN_REASON =
  "Sign in again: the Provider no longer accepts this OAuth Login";

/** When an OAuth Login's access token was granted and when it stops working. */
export interface OauthLoginLifetime {
  /** Null for a login stored before the gateway kept it: its lifetime is unknown. */
  grantedAt: Date | null;
  expiresAt: Date;
}

/**
 * Whether to refresh the login before using it (spec "OAuth Login"): when
 * less is left of it than the larger of 300 seconds and half its lifetime.
 */
export function needsRefresh({ grantedAt, expiresAt }: OauthLoginLifetime, now: Date): boolean {
  const remainingMs = expiresAt.getTime() - now.getTime();
  const lifetimeMs = grantedAt ? expiresAt.getTime() - grantedAt.getTime() : 0;
  return remainingMs < Math.max(MIN_REFRESH_MARGIN_MS, lifetimeMs / 2);
}
