import type { Capability, ModelKind } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";

/** What an Integration's Customers pay for a Model: the prices of the Upstream Model it tries first. */
export type ModelPrices = Pick<
  SnapshotUpstreamModel,
  "inputPrice" | "outputPrice" | "cacheReadPrice" | "cacheWritePrice" | "unitPrices"
>;

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
}
