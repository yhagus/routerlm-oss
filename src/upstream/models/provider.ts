import { BadRequestException } from "@nestjs/common";
import {
  chatEndpointOf,
  quirksForeignToProtocol,
  serviceTierValuesForeignToProtocol,
} from "@/catalog/schemas/catalog.schema.js";
import type {
  ProviderEndpoint,
  ProviderQuirks,
  providers,
  ServiceTierValues,
  UpstreamProtocol,
} from "@/db/schemas/index.js";

export type Provider = typeof providers.$inferSelect;

export function assertQuirksFitEndpoints(
  endpoints: readonly ProviderEndpoint[],
  quirks: ProviderQuirks,
): void {
  const protocol = chatEndpointOf(endpoints)?.protocol;
  const foreignQuirks = quirksForeignToProtocol(protocol, quirks);
  if (foreignQuirks.length > 0) {
    throw new BadRequestException(
      `The quirks ${foreignQuirks.join(", ")} don't apply to ${describeChatProtocol(protocol)}`,
    );
  }
}

export function assertServiceTierValuesFitEndpoints(
  endpoints: readonly ProviderEndpoint[],
  serviceTierValues: ServiceTierValues,
): void {
  const protocol = chatEndpointOf(endpoints)?.protocol;
  const foreignTiers = serviceTierValuesForeignToProtocol(protocol, serviceTierValues);
  if (foreignTiers.length > 0) {
    throw new BadRequestException(
      `The Service Tiers ${foreignTiers.join(", ")} don't apply to ${describeChatProtocol(protocol)}`,
    );
  }
}

function describeChatProtocol(protocol: UpstreamProtocol | undefined): string {
  return protocol === undefined ? "a Provider without a chat endpoint" : `the ${protocol} Protocol`;
}
