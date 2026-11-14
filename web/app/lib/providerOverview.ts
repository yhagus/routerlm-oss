import type { Capability, Provider, ProviderAccount, UpstreamModel } from "~/lib/upstream";
import { CAPABILITIES } from "~/lib/upstream";

/** Where a Provider Account stands for routing, as of `now`. */
export type AccountState = "ready" | "cooldown" | "disabled";

export function accountStateOf(account: ProviderAccount, now: number): AccountState {
  if (!account.isEnabled) return "disabled";
  if (account.cooldownEndsAt && new Date(account.cooldownEndsAt).getTime() > now) return "cooldown";
  return "ready";
}

/** What the Providers page shows on a Provider's card, from its accounts and Upstream Models. */
export interface ProviderStats {
  accounts: Record<AccountState, number> & { total: number };
  models: { enabled: number; total: number };
  /** Largest context window among enabled models; null without one. */
  maxContext: number | null;
  /** Cheapest and dearest input price (USD per million tokens) among enabled models that publish one. */
  inputPrice: { min: number; max: number } | null;
  /** Union of enabled models' capabilities, in `CAPABILITIES` order. */
  capabilities: Capability[];
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
  const prices = enabled.flatMap((model) => (model.inputPrice === null ? [] : [model.inputPrice]));
  const capabilities = new Set(enabled.flatMap((model) => model.capabilities));

  return {
    accounts: counts,
    models: { enabled: enabled.length, total: own.length },
    maxContext: enabled.length ? Math.max(...enabled.map((model) => model.contextSize)) : null,
    inputPrice: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    capabilities: CAPABILITIES.filter((capability) => capabilities.has(capability)),
    isUnroutable: provider.isEnabled && (counts.ready === 0 || enabled.length === 0),
  };
}

const tokenFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A context window as "1M" or "200K". */
export function formatContext(tokens: number | null): string {
  return tokens === null ? "—" : tokenFormat.format(tokens);
}

const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const amountFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** An input price range per million tokens, "$0.4–8" or a single "$0.4". */
export function formatPriceRange(range: { min: number; max: number } | null): string {
  if (range === null) return "—";
  if (range.min === range.max) return priceFormat.format(range.min);
  return `${priceFormat.format(range.min)}–${amountFormat.format(range.max)}`;
}

/** The base URL's host, or the URL itself when it doesn't parse. */
export function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
