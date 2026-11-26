import type { Provider, ProviderAccount, UpstreamModel } from '~/lib/upstream';

export type AccountState = 'ready' | 'cooldown' | 'disabled';

export function accountStateOf(account: ProviderAccount, now: number): AccountState {
  if (!account.isEnabled) return 'disabled';
  if (account.cooldownEndsAt && new Date(account.cooldownEndsAt).getTime() > now) return 'cooldown';
  return 'ready';
}

export interface ProviderStats {
  accounts: Record<AccountState, number> & { total: number };
  models: { enabled: number; total: number };
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

export function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function unroutableReason(stats: ProviderStats): string {
  if (stats.accounts.total === 0) return 'No Provider Account: add a key before routing here.';
  if (stats.accounts.ready === 0) {
    return 'No ready Provider Account: every key is disabled or cooling down.';
  }
  return 'No enabled Upstream Model: enable one before routing here.';
}

export function unroutableShort(stats: ProviderStats): string {
  if (stats.accounts.total === 0) return 'No account';
  if (stats.accounts.ready === 0) return 'No ready account';
  return 'No enabled model';
}
