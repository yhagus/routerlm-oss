import { BadRequestException } from "@nestjs/common";
import {
  quirksForeignToProtocol,
  serviceTierValuesForeignToProtocol,
} from "@/catalog/schemas/catalog.schema.js";
import type {
  ProviderQuirks,
  providers,
  ServiceTierValues,
  UpstreamProtocol,
} from "@/db/schemas/index.js";

/** A Provider as the dashboard API returns it. It holds no secrets. */
export type Provider = typeof providers.$inferSelect;

/** Refuses quirks the Protocol doesn't read, naming them. */
export function assertQuirksFitProtocol(protocol: UpstreamProtocol, quirks: ProviderQuirks): void {
  const foreignQuirks = quirksForeignToProtocol(protocol, quirks);
  if (foreignQuirks.length > 0) {
    throw new BadRequestException(
      `The quirks ${foreignQuirks.join(", ")} don't apply to the ${protocol} Protocol`,
    );
  }
}

/** Refuses Service Tier values on a Protocol whose adapter never sends a tier (ADR 0014), naming the tiers. */
export function assertServiceTierValuesFitProtocol(
  protocol: UpstreamProtocol,
  serviceTierValues: ServiceTierValues,
): void {
  const foreignTiers = serviceTierValuesForeignToProtocol(protocol, serviceTierValues);
  if (foreignTiers.length > 0) {
    throw new BadRequestException(
      `The Service Tiers ${foreignTiers.join(", ")} don't apply to the ${protocol} Protocol`,
    );
  }
}
