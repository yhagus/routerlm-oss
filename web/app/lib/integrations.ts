import type { ApiKeyRotation } from '~/lib/api-keys';
import type { AllowedModelGroup } from '~/lib/modelGroups';
import type { PricingWindowRange } from '~/lib/pricingWindows';
import type { Capability, ModelKind } from '~/lib/upstream';
import { type DetailLine, unitPriceFormat } from '~/lib/upstreamModelMedia';

export interface IntegrationSummary {
  id: string;
  name: string;
  keyId: string;
  createdBy: { id: string; email: string } | null;
  createdAt: string;
  disabledAt: string | null;
  allowedModels: { id: string; name: string | null }[];
  allowedModelGroups: AllowedModelGroup[];
  directUpstreamAccess: boolean;
  lastRotatedAt: string | null;
  lastUsedAt: string | null;
}

export interface IntegrationDetail extends IntegrationSummary {
  activeKeyCount: number;
  revokedKeyCount: number;
  customerCount: number;
}

export type IntegrationRotation = ApiKeyRotation;

export interface IntegrationCustomer {
  customerId: string;
  activeKeyCount: number;
  revokedKeyCount: number;
  spent: number;
  requestCount: number;
  cost: number;
  lastRequestAt: string | null;
}

export interface IntegrationCustomerPage {
  items: IntegrationCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IntegrationModel {
  id: string;
  name: string;
  kind: ModelKind;
  capabilities: Capability[];
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
  pricingWindows: IntegrationPricingWindow[];
}

export interface IntegrationPricingWindow {
  timeZone: string;
  ranges: PricingWindowRange[];
  validFrom?: string;
  validUntil?: string;
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
}

export interface CreatedIntegration extends IntegrationSummary {
  secret: string;
}

export type IntegrationStatus = 'enabled' | 'disabled';

export const INTEGRATION_STATUS_LABELS = {
  enabled: 'Enabled',
  disabled: 'Disabled',
} as const satisfies Record<IntegrationStatus, string>;

export function integrationStatus(integration: IntegrationSummary): IntegrationStatus {
  return integration.disabledAt ? 'disabled' : 'enabled';
}

export const INTEGRATION_CONFIRM_COPY = {
  rotate: {
    title: 'Rotate Integration Secret',
    description: (name: string) =>
      `${name} gets a new Integration Secret, and the current one is refused at once. Its API Keys keep working.`,
    action: 'Rotate secret',
    failed: "Couldn't rotate the Integration Secret.",
  },
  delete: {
    title: 'Delete Integration',
    description: (name: string) =>
      `${name} is deleted for good and all its API Keys are revoked, so its Customers are refused at once. This can't be undone; disable it instead to suspend it.`,
    action: 'Delete Integration',
    failed: "Couldn't delete the Integration.",
  },
} as const;
export type IntegrationConfirmKind = keyof typeof INTEGRATION_CONFIRM_COPY;

const tokenPriceFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
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

export function integrationModelPriceLines(model: IntegrationModel): DetailLine[] {
  return [
    ...priceLine('Input per 1M tokens', model.inputPrice, tokenPriceFormat),
    ...priceLine('Output per 1M tokens', model.outputPrice, tokenPriceFormat),
    ...priceLine('Cache read per 1M tokens', model.cacheReadPrice, tokenPriceFormat),
    ...priceLine('Cache write per 1M tokens', model.cacheWritePrice, tokenPriceFormat),
    ...priceLine('Per image', model.pricePerImage, unitPriceFormat),
    ...tierLines(model.pricePerImageBySize, 'image'),
    ...priceLine('Per input image', model.pricePerInputImage, unitPriceFormat),
    ...tierLines(model.pricePerSecondByResolution, 'per second'),
    ...priceLine('Per 1M characters', model.pricePerMillionCharacters, unitPriceFormat),
    ...priceLine('Per audio second', model.pricePerAudioSecond, unitPriceFormat),
  ];
}

export interface RecordedIntegration {
  integrationId: string | null;
  integrationName: string | null;
  customerId: string | null;
}
