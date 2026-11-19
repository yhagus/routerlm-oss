import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
  kindsWithoutEndpoint,
  serviceTiersWithoutWireValue,
  tierPricesWithoutListedTier,
} from "@/catalog/schemas/catalog.schema.js";
import type { ModelKind, ProviderEndpoint, ServiceTierValues } from "@/db/schemas/index.js";
import type { ServiceTier } from "@/inference/models/internal-format.js";
import {
  FOREIGN_KEY_VIOLATION,
  hasPostgresErrorCode,
  UNIQUE_VIOLATION,
} from "@/libs/models/postgres-errors.js";
import type { upstreamModels } from "@/db/schemas/index.js";

/** An Upstream Model as the dashboard API returns it. */
export type UpstreamModel = typeof upstreamModels.$inferSelect;

/** The HTTP error for a failed Upstream Model insert or update, or the original error. */
export function toUpstreamModelWriteError(
  error: unknown,
  providerModelName: string | undefined,
): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(
      `The Provider already has an Upstream Model named "${providerModelName ?? ""}"`,
    );
  }
  if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new NotFoundException("Provider not found");
  }
  return error;
}

/**
 * Refuses an Upstream Model that lists a Service Tier its Provider maps to no
 * wire value, or prices a tier it doesn't list (ADR 0014), naming the tiers.
 */
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
      `The Provider maps no wire value for the Service Tiers ${unmapped.join(", ")}`,
    );
  }
  const unlisted = tierPricesWithoutListedTier(
    upstreamModel.tierPrices,
    upstreamModel.serviceTiers,
  );
  if (unlisted.length > 0) {
    throw new BadRequestException(
      `The Upstream Model prices the Service Tiers ${unlisted.join(", ")} but doesn't list them`,
    );
  }
}

/** Refuses an Upstream Model of a Kind its Provider has no endpoint for (ADR 0026), naming the Kind. */
export function assertProviderServesKind(
  kind: ModelKind,
  endpoints: readonly ProviderEndpoint[],
): void {
  if (kindsWithoutEndpoint([{ kind }], endpoints).length > 0) {
    throw new BadRequestException(`The Provider has no endpoint for the Kind ${kind}`);
  }
}
