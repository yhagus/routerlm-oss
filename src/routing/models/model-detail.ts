import { NotFoundException } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../db/relations.js";
import { models, providerAccounts, providers, routes, upstreamModels } from "../../db/schema.js";
import type { ModelDetail, RouteSummary } from "./model.js";

/** The Model with its Routes in the order the gateway tries them. */
export async function findModelDetail(db: Database, modelId: string): Promise<ModelDetail> {
  const [model] = await db.select().from(models).where(eq(models.id, modelId));
  if (!model) {
    throw new NotFoundException("Model not found");
  }
  return { ...model, routes: await listRouteSummaries(db, modelId) };
}

function listRouteSummaries(db: Database, modelId: string): Promise<RouteSummary[]> {
  return (
    db
      .select({
        id: routes.id,
        priority: routes.priority,
        isEnabled: routes.isEnabled,
        connectTimeoutMs: routes.connectTimeoutMs,
        firstTokenTimeoutMs: routes.firstTokenTimeoutMs,
        totalTimeoutMs: routes.totalTimeoutMs,
        parameterPolicyOverride: routes.parameterPolicyOverride,
        provider: {
          id: providers.id,
          slug: providers.slug,
          name: providers.name,
          isEnabled: providers.isEnabled,
        },
        upstreamModel: {
          id: upstreamModels.id,
          upstreamModelId: upstreamModels.upstreamModelId,
          capabilities: upstreamModels.capabilities,
          isEnabled: upstreamModels.isEnabled,
        },
        enabledProviderAccountCount: db.$count(
          providerAccounts,
          and(eq(providerAccounts.providerId, providers.id), eq(providerAccounts.isEnabled, true)),
        ),
      })
      .from(routes)
      .innerJoin(upstreamModels, eq(routes.upstreamModelId, upstreamModels.id))
      .innerJoin(providers, eq(upstreamModels.providerId, providers.id))
      .where(eq(routes.modelId, modelId))
      // Equal priorities keep the order the Routes were added in.
      .orderBy(asc(routes.priority), asc(routes.createdAt))
  );
}
