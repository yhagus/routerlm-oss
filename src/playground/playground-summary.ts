import type { TokenUsage } from "../inference/internal-format.js";
import type { Snapshot, SnapshotRoute } from "../snapshot/snapshot.js";
import type { UsageJob } from "../usage/models/usage-job.js";
import { usageMeasurementsOf } from "../usage/models/usage-measurements.js";

/**
 * What the Playground shows after each response (spec "Playground"). It goes
 * out as the stream's last event, so nothing about the conversation is stored.
 */
export interface PlaygroundSummary {
  usage: TokenUsage;
  /** USD, from the Upstream Model's prices at request time; null when unknown. */
  cost: number | null;
  /** Null when no Attempt answered, or the Route was deleted meanwhile. */
  route: { id: string; providerSlug: string; upstreamModelId: string } | null;
  providerAccount: { id: string; name: string } | null;
}

/** The summary of a finished Playground request, named from the current snapshot. */
export function playgroundSummaryOf(job: UsageJob, snapshot: Snapshot): PlaygroundSummary {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, cost } =
    usageMeasurementsOf(job.servedBy, job.usage);
  const usage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens };
  const { servedBy } = job;
  const route = servedBy ? findRoute(snapshot, job.modelId, servedBy.routeId) : undefined;
  if (!servedBy || !route) {
    return { usage, cost, route: null, providerAccount: null };
  }
  const { upstreamModel } = route;
  const providerAccount = upstreamModel.provider.providerAccounts.find(
    (account) => account.id === servedBy.providerAccountId,
  );
  return {
    usage,
    cost,
    route: {
      id: route.id,
      providerSlug: upstreamModel.provider.slug,
      upstreamModelId: upstreamModel.upstreamModelId,
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
