import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  kindsWithoutEndpoint,
  serviceTiersWithoutWireValue,
  tierPricesWithoutListedTier,
} from '@/catalog/schemas/catalog.schema';
import type { ModelKind, ProviderEndpoint, ServiceTierValues } from '@/db/schemas';
import type { ServiceTier } from '@/inference/models/internal-format';
import {
  FOREIGN_KEY_VIOLATION,
  hasPostgresErrorCode,
  UNIQUE_VIOLATION,
} from '@/libs/models/postgres-errors';
import {
  kindOf,
  type ProtocolListing,
  protocolsWithoutEndpoint,
} from '@/libs/models/provider-protocols';
import type { upstreamModels } from '@/db/schemas';
import type { AttachedPricingWindow } from '@/pricing-windows/models/upstream-model-pricing-windows';

export type UpstreamModel = typeof upstreamModels.$inferSelect;

export interface ListedUpstreamModel extends UpstreamModel {
  pricingWindows: AttachedPricingWindow[];
}

export function toUpstreamModelWriteError(
  error: unknown,
  providerModelName: string | undefined,
): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(
      `The Provider already has an Upstream Model named "${providerModelName ?? ''}"`,
    );
  }
  if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new NotFoundException('Provider not found');
  }
  return error;
}

export function assertServiceTiersFitProvider(
  upstreamModel: {
    serviceTiers: readonly ServiceTier[];
    tierPrices: Partial<Record<ServiceTier, unknown>>;
  },
  serviceTierValues: ServiceTierValues,
): void {
  const unmapped = serviceTiersWithoutWireValue(upstreamModel.serviceTiers, serviceTierValues);
  if (unmapped.length > 0) {
    throw new BadRequestException(
      `The Provider maps no wire value for the Service Tiers ${unmapped.join(', ')}`,
    );
  }
  const unlisted = tierPricesWithoutListedTier(
    upstreamModel.tierPrices,
    upstreamModel.serviceTiers,
  );
  if (unlisted.length > 0) {
    throw new BadRequestException(
      `The Upstream Model prices the Service Tiers ${unlisted.join(', ')} but doesn't list them`,
    );
  }
}

export function assertProviderServesKind(
  kind: ModelKind,
  endpoints: readonly ProviderEndpoint[],
): void {
  if (kindsWithoutEndpoint([{ kind }], endpoints).length > 0) {
    throw new BadRequestException(`The Provider has no endpoint for the Kind ${kind}`);
  }
}

export function assertProtocolsFitProvider(
  upstreamModel: ProtocolListing,
  endpoints: readonly ProviderEndpoint[],
): void {
  const unserved = protocolsWithoutEndpoint(upstreamModel, endpoints);
  if (unserved.length > 0) {
    throw new BadRequestException(
      `The Provider has no ${kindOf(upstreamModel)} endpoint for the Protocols ${unserved.join(', ')}`,
    );
  }
}
