import type { Capability, ModelKind, PricingWindowRange } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";

/** What an Integration's Customers pay for a Model: the prices of the Upstream Model it tries first. */
export type ModelPrices = Pick<
  SnapshotUpstreamModel,
  "inputPrice" | "outputPrice" | "cacheReadPrice" | "cacheWritePrice" | "unitPrices"
>;

/**
 * Window Prices on an enabled Pricing Window of the Upstream Model behind the
 * prices, as an Integration sees them: their schedule, Validity Period and
 * resolved prices, never the window's name or id.
 */
export interface IntegrationPricingWindow {
  timeZone: string;
  ranges: PricingWindowRange[];
  /** The Validity Period's bounds as instants; null when open-ended. */
  validFrom: Date | null;
  validUntil: Date | null;
  /** Each Window Price left out is filled with the standard price. */
  prices: UpstreamModelPrices;
}

/**
 * A Model an Integration may sell, as the control plane shows it to that
 * Integration (Model in control_plane.proto). Never the Provider, Provider
 * Account, Route or Upstream Model that serves it.
 */
export interface IntegrationModel {
  id: string;
  name: string;
  kind: ModelKind;
  /** What at least one of its usable Routes can do. */
  capabilities: Capability[];
  /** Null when no Route can serve it right now. */
  prices: ModelPrices | null;
  /**
   * Those whose Validity Period hasn't ended, earliest start first (open start
   * first), then by window name; empty when no Route can serve it.
   */
  pricingWindows: IntegrationPricingWindow[];
}
