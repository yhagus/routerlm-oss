import { asc, isNull } from "drizzle-orm";
import { storedProviderQuirksSchema } from "@/catalog/schemas/catalog.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { SettingsStore } from "@/settings/providers/settings-store.js";
import {
  apiKeys,
  type ModelKind,
  type ProviderEndpoint,
  type CredentialKind,
  models,
  providerAccounts,
  providers,
  routes,
  upstreamModels,
} from "@/db/schemas/index.js";
import type {
  Snapshot,
  SnapshotApiKey,
  SnapshotCredential,
  SnapshotEndpoint,
  SnapshotModel,
  SnapshotProvider,
  SnapshotProviderAccount,
  SnapshotUpstreamModel,
} from "./snapshot.js";
import { providerIsUsable } from "./provider-usability.js";

/** Reads the whole snapshot. The tables are operator-sized, so it reads them whole. */
export async function loadSnapshot(db: Database): Promise<Snapshot> {
  const [
    keyRows,
    providerRows,
    accountRows,
    upstreamModelRows,
    modelRows,
    routeRows,
    allowsTermsRiskProviders,
  ] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
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
    // Not injected: SettingsModule imports SnapshotModule to call changed().
    new SettingsStore(db).read("allowTermsRiskProviders"),
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
        name: provider.name,
        endpoints: endpointsByKind(provider.endpoints),
        authStyle: provider.authStyle,
        quirks: storedProviderQuirksSchema.safeParse(provider.quirks),
        serviceTierValues: provider.serviceTierValues,
        isUsable: providerIsUsable(provider, allowsTermsRiskProviders.value),
        providerAccounts: (accountsByProviderId.get(provider.id) ?? []).flatMap(
          (account): SnapshotProviderAccount[] => {
            const credential = snapshotCredentialOf(account);
            if (credential === null) return [];
            return [
              {
                id: account.id,
                name: account.name,
                credential,
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
        kind: upstreamModel.kind,
        capabilities: upstreamModel.capabilities,
        contextSize: upstreamModel.contextSize,
        maxOutputTokens: upstreamModel.maxOutputTokens,
        inputPrice: upstreamModel.inputPrice,
        outputPrice: upstreamModel.outputPrice,
        cacheReadPrice: upstreamModel.cacheReadPrice,
        cacheWritePrice: upstreamModel.cacheWritePrice,
        serviceTiers: upstreamModel.serviceTiers,
        tierPrices: upstreamModel.tierPrices,
        unitPrices: {
          pricePerImage: upstreamModel.pricePerImage,
          pricePerImageBySize: upstreamModel.pricePerImageBySize,
          pricePerInputImage: upstreamModel.pricePerInputImage,
          pricePerSecondByResolution: upstreamModel.pricePerSecondByResolution,
          pricePerMillionCharacters: upstreamModel.pricePerMillionCharacters,
        },
        sizes: upstreamModel.sizes,
        maxInputImages: upstreamModel.maxInputImages,
        resolutions: upstreamModel.resolutions,
        minDurationSeconds: upstreamModel.minDurationSeconds,
        maxDurationSeconds: upstreamModel.maxDurationSeconds,
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
      // The routing write path refuses a Route of another Kind; this keeps
      // one that slipped past it from ever serving.
      if (!upstreamModel || upstreamModel.kind !== model.kind) {
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
      kind: model.kind,
      isEnabled: model.isEnabled,
      parameterPolicy: model.parameterPolicy,
      hasAutomaticCacheBreakpoints: model.hasAutomaticCacheBreakpoints,
      createdAt: model.createdAt,
      routes: modelRoutes,
    });
  }

  return { apiKeysByKeyId, modelsByName, upstreamModelsById };
}

/** Null for an API key account without a key, which no Route can use. */
function snapshotCredentialOf(account: {
  credentialKind: CredentialKind;
  encryptedKey: string | null;
}): SnapshotCredential | null {
  if (account.credentialKind === "oauth-login") {
    return { kind: "oauth-login" };
  }
  if (account.encryptedKey === null) {
    return null;
  }
  return { kind: "api-key", encryptedKey: account.encryptedKey };
}

function endpointsByKind(
  endpoints: readonly ProviderEndpoint[],
): Partial<Record<ModelKind, SnapshotEndpoint>> {
  const byKind: Partial<Record<ModelKind, SnapshotEndpoint>> = {};
  for (const { kind, protocol, baseUrl } of endpoints) {
    byKind[kind] = { protocol, baseUrl };
  }
  return byKind;
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
