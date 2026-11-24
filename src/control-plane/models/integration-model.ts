import type { Capability, ModelKind, PricingWindowRange } from "@/db/schemas/index.js";
import type { SnapshotUpstreamModel } from "@/snapshot/models/snapshot.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";

export type ModelPrices = Pick<
  SnapshotUpstreamModel,
  "inputPrice" | "outputPrice" | "cacheReadPrice" | "cacheWritePrice" | "unitPrices"
>;

export interface IntegrationPricingWindow {
  timeZone: string;
  ranges: PricingWindowRange[];
  validFrom: Date | null;
  validUntil: Date | null;
  prices: UpstreamModelPrices;
}

export interface IntegrationModel {
  id: string;
  name: string;
  kind: ModelKind;
  capabilities: Capability[];
  prices: ModelPrices | null;
  pricingWindows: IntegrationPricingWindow[];
}
