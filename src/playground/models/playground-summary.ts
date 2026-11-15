import type { TokenUsage } from "@/inference/models/internal-format.js";
import type { Snapshot, SnapshotRoute } from "@/snapshot/models/snapshot.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { usageMeasurementsOf } from "@/usage/models/usage-measurements.js";

/**
 * What the Playground shows after each response (spec "Playground"). It goes
 * out as the stream's last event, so nothing about the conversation is stored.
 */
export interface PlaygroundSummary {
  usage: TokenUsage;
  /** USD, from the Upstream Model's prices at request time; null when unknown. */
  cost: number | null;
  /**
   * Null when no Attempt answered, the Route was deleted meanwhile, or the
   * request was a direct Upstream Model test, which goes through no Route.
   */
  route: { id: string; providerSlug: string; upstreamModelId: string } | null;
  /** The Upstream Model that answered; null when none did, or it was deleted meanwhile. */
  upstreamModel: { id: string; upstreamModelId: string; providerSlug: string } | null;
  providerAccount: { id: string; name: string } | null;
}

/** The summary of a finished Playground request, named from the current snapshot. */
export function playgroundSummaryOf(job: UsageJob, snapshot: Snapshot): PlaygroundSummary {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, cost } =
    usageMeasurementsOf(job.servedBy, job.usage);
  const usage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens };
  const { servedBy } = job;
  const upstreamModel = servedBy && snapshot.upstreamModelsById.get(servedBy.upstreamModelId);
  if (!servedBy || !upstreamModel) {
    return { usage, cost, route: null, upstreamModel: null, providerAccount: null };
  }
  const { provider } = upstreamModel;
  const route = servedBy.routeId ? findRoute(snapshot, job.modelId, servedBy.routeId) : undefined;
  const providerAccount = provider.providerAccounts.find(
    (account) => account.id === servedBy.providerAccountId,
  );
  return {
    usage,
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
