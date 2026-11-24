import type { TokenUsage } from "@/inference/models/internal-format.js";
import type { Snapshot, SnapshotRoute } from "@/snapshot/models/snapshot.js";
import type { MediaUnits, UsageJob } from "@/usage/models/usage-job.js";
import { unitCostOf, usageMeasurementsOf } from "@/usage/models/usage-measurements.js";

export interface PlaygroundSummary {
  usage: TokenUsage;
  units: MediaUnits | null;
  cost: number | null;
  route: { id: string; providerSlug: string; upstreamModelId: string } | null;
  upstreamModel: { id: string; upstreamModelId: string; providerSlug: string } | null;
  providerAccount: { id: string; name: string } | null;
}

export function playgroundSummaryOf(job: UsageJob, snapshot: Snapshot): PlaygroundSummary {
  const measurements = usageMeasurementsOf(job.servedBy, job.usage);
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens } =
    measurements;
  const usage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens };
  const units = job.units ?? null;
  const cost = units ? unitCostOf(job.servedBy, units) : measurements.cost;
  const { servedBy } = job;
  const upstreamModel = servedBy && snapshot.upstreamModelsById.get(servedBy.upstreamModelId);
  if (!servedBy || !upstreamModel) {
    return { usage, units, cost, route: null, upstreamModel: null, providerAccount: null };
  }
  const { provider } = upstreamModel;
  const route = servedBy.routeId ? findRoute(snapshot, job.modelId, servedBy.routeId) : undefined;
  const providerAccount = provider.providerAccounts.find(
    (account) => account.id === servedBy.providerAccountId,
  );
  return {
    usage,
    units,
    cost,
    route: route
      ? {
          id: route.id,
          providerSlug: route.upstreamModel.provider.slug,
          upstreamModelId: route.upstreamModel.upstreamModelId,
        }
      : null,
    upstreamModel: {
      id: upstreamModel.id,
      upstreamModelId: upstreamModel.upstreamModelId,
      providerSlug: provider.slug,
    },
    providerAccount: providerAccount
      ? { id: providerAccount.id, name: providerAccount.name }
      : null,
  };
}

function findRoute(
  snapshot: Snapshot,
  modelId: string | null,
  routeId: string,
): SnapshotRoute | undefined {
  for (const model of snapshot.modelsByName.values()) {
    if (model.id === modelId) {
      return model.routes.find((route) => route.id === routeId);
    }
  }
  return undefined;
}
