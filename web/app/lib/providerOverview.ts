import type { Provider, ProviderAccount, UpstreamModel } from "~/lib/upstream";

/** Where a Provider Account stands for routing, as of `now`. */
export type AccountState = "ready" | "cooldown" | "disabled";

export function accountStateOf(account: ProviderAccount, now: number): AccountState {
  if (!account.isEnabled) return "disabled";
  if (account.cooldownEndsAt && new Date(account.cooldownEndsAt).getTime() > now) return "cooldown";
  return "ready";
}

/** What the Providers page shows in a Provider's row, from its accounts and Upstream Models. */
export interface ProviderStats {
  accounts: Record<AccountState, number> & { total: number };
  models: { enabled: number; total: number };
  /** An enabled Provider no request can reach: no ready account or no enabled model. */
  isUnroutable: boolean;
}

export function providerStats(
  provider: Provider,
  accounts: ProviderAccount[],
  models: UpstreamModel[],
  now: number,
): ProviderStats {
  const counts = { ready: 0, cooldown: 0, disabled: 0, total: 0 };
  for (const account of accounts) {
    if (account.providerId !== provider.id) continue;
    counts[accountStateOf(account, now)] += 1;
    counts.total += 1;
  }

  const own = models.filter((model) => model.providerId === provider.id);
  const enabled = own.filter((model) => model.isEnabled);

  return {
    accounts: counts,
    models: { enabled: enabled.length, total: own.length },
    isUnroutable: provider.isEnabled && (counts.ready === 0 || enabled.length === 0),
  };
}

/** The base URL's host, or the URL itself when it doesn't parse. */
export function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Why an enabled Provider can't take traffic, in a sentence. */
export function unroutableReason(stats: ProviderStats): string {
  if (stats.accounts.total === 0) return "No Provider Account: add a key before routing here.";
  if (stats.accounts.ready === 0) {
    return "No ready Provider Account: every key is disabled or cooling down.";
  }
  return "No enabled Upstream Model: enable one before routing here.";
}

/** The same reason in two or three words, for a status cell. */
export function unroutableShort(stats: ProviderStats): string {
  if (stats.accounts.total === 0) return "No account";
  if (stats.accounts.ready === 0) return "No ready account";
  return "No enabled model";
}
