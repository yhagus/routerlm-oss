import type { ApiKeyRotation } from "~/lib/api-keys";
import type { PricingWindowRange } from "~/lib/pricingWindows";
import type { Capability, ModelKind } from "~/lib/upstream";
import { type DetailLine, unitPriceFormat } from "~/lib/upstreamModelMedia";

/** An Integration as the dashboard API lists it: never its Integration Secret. */
export interface IntegrationSummary {
  id: string;
  name: string;
  /** The public id inside the Integration Secret, `rlmi_<keyId>_<secret>`. */
  keyId: string;
  /** Null when the User who created it was deleted. */
  createdBy: { id: string; email: string } | null;
  createdAt: string;
  /** Null while the Integration is enabled. */
  disabledAt: string | null;
  /** Empty means every Model. A `null` name is a Model that was deleted. */
  allowedModels: { id: string; name: string | null }[];
  /** Null when its Integration Secret was never rotated. */
  lastRotatedAt: string | null;
  /** When its Integration Secret last signed a control plane call in, to the minute. Null if never. */
  lastUsedAt: string | null;
}

/** One Integration as `GET /integrations/:id` returns it: its summary and its counts. */
export interface IntegrationDetail extends IntegrationSummary {
  /** API Keys it issued that are not revoked, expired ones included. */
  activeKeyCount: number;
  revokedKeyCount: number;
  /** Distinct Customers named on its API Keys, revoked ones included. */
  customerCount: number;
}

/** One rotation of an Integration Secret, shaped like an API Key's, newest first. */
export type IntegrationRotation = ApiKeyRotation;

/** One Customer of an Integration, rolled up over all time from its API Keys and their Usage Logs. */
export interface IntegrationCustomer {
  customerId: string;
  activeKeyCount: number;
  revokedKeyCount: number;
  /** USD its API Keys have spent against their Spend Limits. */
  spent: number;
  requestCount: number;
  /** USD of Cost over its Usage Logs; logs of unknown Cost count as 0. */
  cost: number;
  /** Null when its API Keys never made a request. */
  lastRequestAt: string | null;
}

/** One page of `GET /integrations/:id/customers`, most recently active first. */
export interface IntegrationCustomerPage {
  items: IntegrationCustomer[];
  /** How many Customers match the search, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * A Model the Integration may sell, as `GET /integrations/:id/models` and the
 * control plane list it. Prices are USD; an unset price is left out.
 */
export interface IntegrationModel {
  id: string;
  name: string;
  kind: ModelKind;
  capabilities: Capability[];
  /** Per million tokens, for chat Models. */
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  pricePerImage?: number;
  pricePerImageBySize?: Record<string, number>;
  pricePerInputImage?: number;
  pricePerSecondByResolution?: Record<string, number>;
  pricePerMillionCharacters?: number;
  pricePerAudioSecond?: number;
  /** The enabled Pricing Windows of the first usable Route, in order, with prices resolved. */
  pricingWindows: IntegrationPricingWindow[];
}

/** A Pricing Window as an Integration sees it: no name or id, a price left out falls back already. */
export interface IntegrationPricingWindow {
  timeZone: string;
  ranges: PricingWindowRange[];
  /** RFC 3339; left out when open-ended. */
  validFrom?: string;
  validUntil?: string;
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
}

/** The create and rotate responses: the whole Integration Secret, shown this once. */
export interface CreatedIntegration extends IntegrationSummary {
  secret: string;
}

export type IntegrationStatus = "enabled" | "disabled";

export const INTEGRATION_STATUS_LABELS = {
  enabled: "Enabled",
  disabled: "Disabled",
} as const satisfies Record<IntegrationStatus, string>;

export function integrationStatus(integration: IntegrationSummary): IntegrationStatus {
  return integration.disabledAt ? "disabled" : "enabled";
}

export function allowedModelsLabel(integration: IntegrationSummary): string {
  if (integration.allowedModels.length === 0) return "All Models";
  return integration.allowedModels.map((model) => model.name ?? "Deleted Model").join(", ");
}

/** The confirmation dialog's copy for the two Integration actions that can't be undone in one click. */
export const INTEGRATION_CONFIRM_COPY = {
  rotate: {
    title: "Rotate Integration Secret",
    description: (name: string) =>
      `${name} gets a new Integration Secret, and the current one is refused at once. Its API Keys keep working.`,
    action: "Rotate secret",
    failed: "Couldn't rotate the Integration Secret.",
  },
  delete: {
    title: "Delete Integration",
    description: (name: string) =>
      `${name} is deleted for good and all its API Keys are revoked, so its Customers are refused at once. This can't be undone; disable it instead to suspend it.`,
    action: "Delete Integration",
    failed: "Couldn't delete the Integration.",
  },
} as const;
export type IntegrationConfirmKind = keyof typeof INTEGRATION_CONFIRM_COPY;

/** Token prices are per million tokens and stop at four decimals. */
const tokenPriceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

function priceLine(
  label: string,
  price: number | undefined,
  format: Intl.NumberFormat,
): DetailLine[] {
  return price === undefined ? [] : [{ label, value: format.format(price) }];
}

function tierLines(prices: Record<string, number> | undefined, unit: string): DetailLine[] {
  return Object.entries(prices ?? {}).map(([tier, price]) => ({
    label: `${tier} ${unit}`,
    value: unitPriceFormat.format(price),
  }));
}

/** Every price an Integration's Model has set, such as "Input per 1M tokens: $3". */
export function integrationModelPriceLines(model: IntegrationModel): DetailLine[] {
  return [
    ...priceLine("Input per 1M tokens", model.inputPrice, tokenPriceFormat),
    ...priceLine("Output per 1M tokens", model.outputPrice, tokenPriceFormat),
    ...priceLine("Cache read per 1M tokens", model.cacheReadPrice, tokenPriceFormat),
    ...priceLine("Cache write per 1M tokens", model.cacheWritePrice, tokenPriceFormat),
    ...priceLine("Per image", model.pricePerImage, unitPriceFormat),
    ...tierLines(model.pricePerImageBySize, "image"),
    ...priceLine("Per input image", model.pricePerInputImage, unitPriceFormat),
    ...tierLines(model.pricePerSecondByResolution, "per second"),
    ...priceLine("Per 1M characters", model.pricePerMillionCharacters, unitPriceFormat),
    ...priceLine("Per audio second", model.pricePerAudioSecond, unitPriceFormat),
  ];
}

/**
 * The Integration that issued a request's API Key and the Customer it names, as
 * a Usage Log or Error Capture copied them at request time, so they outlive the
 * Integration. All null for a key no Integration issued.
 */
export interface RecordedIntegration {
  integrationId: string | null;
  integrationName: string | null;
  customerId: string | null;
}
