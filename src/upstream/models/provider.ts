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

/** A Provider as the dashboard API returns it. It holds no secrets. */
export type Provider = typeof providers.$inferSelect;

/** Refuses quirks the Protocol of the chat endpoint doesn't read, naming them. */
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

/**
 * Refuses Service Tier values unless the chat endpoint's Protocol sends a
 * tier (ADR 0014), naming the tiers.
 */
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
