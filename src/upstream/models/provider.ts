import { BadRequestException } from "@nestjs/common";
import {
  quirksForeignToEndpoints,
  serviceTierValuesForeignToEndpoints,
} from "@/catalog/schemas/catalog.schema.js";
import { describeProtocols } from "@/libs/models/provider-protocols.js";
import type {
  ProviderEndpoint,
  ProviderQuirks,
  providers,
  ServiceTierValues,
} from "@/db/schemas/index.js";

export type Provider = typeof providers.$inferSelect;

export function assertQuirksFitEndpoints(
  endpoints: readonly ProviderEndpoint[],
  quirks: ProviderQuirks,
): void {
  const foreignQuirks = quirksForeignToEndpoints(endpoints, quirks);
  if (foreignQuirks.length > 0) {
    throw new BadRequestException(
      `The quirks ${foreignQuirks.join(", ")} don't apply to ${describeProtocols(endpoints)}`,
    );
  }
}

export function assertServiceTierValuesFitEndpoints(
  endpoints: readonly ProviderEndpoint[],
  serviceTierValues: ServiceTierValues,
): void {
  const foreignTiers = serviceTierValuesForeignToEndpoints(endpoints, serviceTierValues);
  if (foreignTiers.length > 0) {
    throw new BadRequestException(
      `The Service Tiers ${foreignTiers.join(", ")} don't apply to ${describeProtocols(endpoints)}`,
    );
  }
}
