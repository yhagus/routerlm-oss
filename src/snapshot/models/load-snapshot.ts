import { asc, isNull } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import {
  apiKeys,
  models,
  providerAccounts,
  providers,
  routes,
  upstreamModels,
} from "@/db/schemas/index.js";
import type {
  Snapshot,
  SnapshotApiKey,
  SnapshotModel,
  SnapshotProvider,
  SnapshotProviderAccount,
  SnapshotUpstreamModel,
} from "./snapshot.js";

/** Reads the whole snapshot. The tables are operator-sized, so it reads them whole. */
export async function loadSnapshot(db: Database): Promise<Snapshot> {
  const [keyRows, providerRows, accountRows, upstreamModelRows, modelRows, routeRows] =
    await Promise.all([
      db
        .select({
          id: apiKeys.id,
          keyId: apiKeys.keyId,
          hash: apiKeys.hash,
          expiresAt: apiKeys.expiresAt,
          allowedModelIds: apiKeys.allowedModelIds,
        })
        .from(apiKeys)
        .where(isNull(apiKeys.revokedAt)),
      db.select().from(providers),
      db
        .select()
        .from(providerAccounts)
        .orderBy(asc(providerAccounts.priority), asc(providerAccounts.createdAt)),
      db.select().from(upstreamModels),
      db.select().from(models),
      db.select().from(routes).orderBy(asc(routes.priority), asc(routes.createdAt)),
    ]);

  const apiKeysByKeyId = new Map<string, SnapshotApiKey>(
    keyRows.map(({ keyId, ...key }) => [keyId, key]),
  );

  const accountsByProviderId = groupBy(accountRows, (account) => account.providerId);
  const providersById = new Map<string, SnapshotProvider>(
    providerRows.map((provider) => [
      provider.id,
      {
        id: provider.id,
        slug: provider.slug,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        authStyle: provider.authStyle,
        quirks: provider.quirks,
        isEnabled: provider.isEnabled,
        providerAccounts: (accountsByProviderId.get(provider.id) ?? []).flatMap(
          (account): SnapshotProviderAccount[] => {
            // An account holding an OAuth Login has no key, and the gateway
            // can't serve from a login yet: no Route reaches it.
            if (account.encryptedKey === null) return [];
            return [
              {
                id: account.id,
                name: account.name,
                encryptedKey: account.encryptedKey,
                priority: account.priority,
                isEnabled: account.isEnabled,
              },
            ];
          },
        ),
      },
    ]),
  );

  const upstreamModelsById = new Map<string, SnapshotUpstreamModel>();
  for (const upstreamModel of upstreamModelRows) {
    const provider = providersById.get(upstreamModel.providerId);
    if (provider) {
      upstreamModelsById.set(upstreamModel.id, {
        id: upstreamModel.id,
        upstreamModelId: upstreamModel.upstreamModelId,
        capabilities: upstreamModel.capabilities,
        contextSize: upstreamModel.contextSize,
        maxOutputTokens: upstreamModel.maxOutputTokens,
        inputPrice: upstreamModel.inputPrice,
        outputPrice: upstreamModel.outputPrice,
        cacheReadPrice: upstreamModel.cacheReadPrice,
        cacheWritePrice: upstreamModel.cacheWritePrice,
        isEnabled: upstreamModel.isEnabled,
        provider,
      });
    }
  }

  const routesByModelId = groupBy(routeRows, (route) => route.modelId);
  const modelsByName = new Map<string, SnapshotModel>();
  for (const model of modelRows) {
    const modelRoutes = (routesByModelId.get(model.id) ?? []).flatMap((route) => {
      const upstreamModel = upstreamModelsById.get(route.upstreamModelId);
      if (!upstreamModel) {
        return [];
      }
      return [
        {
          id: route.id,
          priority: route.priority,
          isEnabled: route.isEnabled,
          parameterPolicyOverride: route.parameterPolicyOverride,
          connectTimeoutMs: route.connectTimeoutMs,
          firstTokenTimeoutMs: route.firstTokenTimeoutMs,
          totalTimeoutMs: route.totalTimeoutMs,
          upstreamModel,
        },
      ];
    });
    modelsByName.set(model.name, {
      id: model.id,
      name: model.name,
      isEnabled: model.isEnabled,
      parameterPolicy: model.parameterPolicy,
      hasAutomaticCacheBreakpoints: model.hasAutomaticCacheBreakpoints,
      createdAt: model.createdAt,
      routes: modelRoutes,
    });
  }

  return { apiKeysByKeyId, modelsByName, upstreamModelsById };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}
