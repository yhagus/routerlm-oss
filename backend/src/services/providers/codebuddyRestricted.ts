// CodeBuddy intl-cli account restriction tracking.
//
// CodeBuddy answers every request from an account it flagged for unusual
// activity with HTTP 403 and code 11140 ("request illegal"). The restriction
// lasts until an appeal succeeds, so a timed cooldown would keep putting the
// account back into rotation. Instead the account gets a sticky marker: chat
// routing skips it, but it stays active so the daily probe keeps refreshing
// its token. A manual cooldown reset, or any successful request, clears it.
export const CODEBUDDY_INTL_CLI_PROVIDER = "codebuddy-intl-cli";
export const CODEBUDDY_ACCOUNT_RESTRICTED_CODE = 11140;
export const CODEBUDDY_RESTRICTED_MARKER = "codebuddyRestrictedAt";

/** True when an upstream failure is CodeBuddy's account restriction. */
export function isCodebuddyAccountRestricted(provider: string, code: string | null | undefined): boolean {
  if (provider !== CODEBUDDY_INTL_CLI_PROVIDER) return false;
  return String(code || "").trim() === String(CODEBUDDY_ACCOUNT_RESTRICTED_CODE);
}

/** ISO time the account was marked restricted, or null when it is not. */
export function codebuddyRestrictedAt(data: Record<string, unknown> | null | undefined): string | null {
  const markedAt = data?.[CODEBUDDY_RESTRICTED_MARKER];
  if (!markedAt) return null;
  const ts = new Date(String(markedAt)).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}
