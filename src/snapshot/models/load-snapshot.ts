import { and, asc, eq, isNull, or } from "drizzle-orm";
import { storedProviderQuirksSchema } from "@/catalog/schemas/catalog.schema";
import type { Database } from "@/db/schemas/relations";
import {
  type AttachedPricingWindowRow,
  selectAttachedPricingWindows,
} from "@/pricing-windows/models/upstream-model-pricing-windows";
import { SettingsStore } from "@/settings/providers/settings-store";
import {
  apiKeys,
  type CredentialKind,
  integrations,
  models,
  pricingWindows,
  providerAccounts,
  providers,
  routes,
  upstreamModels,
} from "@/db/schemas";
import type {
  Snapshot,
  SnapshotApiKey,
  SnapshotCredential,
  SnapshotModel,
  SnapshotPricingWindow,
  SnapshotProvider,
  SnapshotProviderAccount,
  SnapshotUpstreamModel,
} from "./snapshot";
import { providerIsUsable } from "./provider-usability";

export async function loadSnapshot(db: Database): Promise<Snapshot> {
  const [
    keyRows,
    providerRows,
    accountRows,
    upstreamModelRows,
    pricingWindowRows,
    modelRows,
    routeRows,
    allowsTermsRiskProviders,
    allowsPrivateUpstreams,
  ] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyId: apiKeys.keyId,
        hash: apiKeys.hash,
        expiresAt: apiKeys.expiresAt,
        allowedModelIds: apiKeys.allowedModelIds,
        spendLimit: apiKeys.spendLimit,
        requestRate: apiKeys.requestRate,
        customerId: apiKeys.customerId,
        integrationId: integrations.id,
        integrationName: integrations.name,
        integrationAllowedModelIds: integrations.allowedModelIds,
      })
      .from(apiKeys)
      .leftJoin(integrations, eq(apiKeys.integrationId, integrations.id))
      .where(
        and(
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.integrationId), isNull(integrations.disabledAt)),
        ),
      ),
    db.select().from(providers),
    db
      .select()
      .from(providerAccounts)
      .orderBy(asc(providerAccounts.priority), asc(providerAccounts.createdAt)),
    db.select().from(upstreamModels),
    selectAttachedPricingWindows(db, eq(pricingWindows.isEnabled, true)),
    db.select().from(models),
    db.select().from(routes).orderBy(asc(routes.priority), asc(routes.createdAt)),
    new SettingsStore(db).read("allowTermsRiskProviders"),
    new SettingsStore(db).read("allowPrivateUpstreams"),
  ]);

  const apiKeysByKeyId = new Map<string, SnapshotApiKey>(
    keyRows.map((row) => [row.keyId, snapshotApiKeyOf(row)]),
  );

  const accountsByProviderId = groupBy(accountRows, (account) => account.providerId);
  const providersById = new Map<string, SnapshotProvider>(
    providerRows.map((provider) => [
      provider.id,
      {
        id: provider.id,
        slug: provider.slug,
        name: provider.name,
        endpoints: provider.endpoints,
        authStyle: provider.authStyle,
        quirks: storedProviderQuirksSchema.safeParse(provider.quirks),
        serviceTierValues: provider.serviceTierValues,
        isUsable: providerIsUsable(provider, allowsTermsRiskProviders.value),
        isRefusedForTermsRisk: provider.termsRisk && !allowsTermsRiskProviders.value,
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

  const pricingWindowsByUpstreamModelId = groupBy(
    pricingWindowRows,
    (pricingWindow) => pricingWindow.upstreamModelId,
  );

  const upstreamModelsById = new Map<string, SnapshotUpstreamModel>();
  for (const upstreamModel of upstreamModelRows) {
    const provider = providersById.get(upstreamModel.providerId);
    if (provider) {
      upstreamModelsById.set(upstreamModel.id, {
        id: upstreamModel.id,
        upstreamModelId: upstreamModel.upstreamModelId,
        kind: upstreamModel.kind,
        protocols: upstreamModel.protocols,
        capabilities: upstreamModel.capabilities,
        contextSize: upstreamModel.contextSize,
        maxOutputTokens: upstreamModel.maxOutputTokens,
        inputPrice: upstreamModel.inputPrice,
        outputPrice: upstreamModel.outputPrice,
        cacheReadPrice: upstreamModel.cacheReadPrice,
        cacheWritePrice: upstreamModel.cacheWritePrice,
        serviceTiers: upstreamModel.serviceTiers,
        tierPrices: upstreamModel.tierPrices,
        pricingWindows: (pricingWindowsByUpstreamModelId.get(upstreamModel.id) ?? []).map(
          snapshotPricingWindowOf,
        ),
        unitPrices: {
          pricePerImage: upstreamModel.pricePerImage,
          pricePerImageBySize: upstreamModel.pricePerImageBySize,
          pricePerInputImage: upstreamModel.pricePerInputImage,
          pricePerSecondByResolution: upstreamModel.pricePerSecondByResolution,
          pricePerMillionCharacters: upstreamModel.pricePerMillionCharacters,
          pricePerAudioSecond: upstreamModel.pricePerAudioSecond,
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

  return {
    apiKeysByKeyId,
    modelsByName,
    upstreamModelsById,
    allowsPrivateUpstreams: allowsPrivateUpstreams.value,
  };
}

function snapshotApiKeyOf(row: {
  id: string;
  name: string;
  hash: string;
  expiresAt: Date | null;
  allowedModelIds: string[];
  spendLimit: number | null;
  requestRate: number | null;
  customerId: string | null;
  integrationId: string | null;
  integrationName: string | null;
  integrationAllowedModelIds: string[] | null;
}): SnapshotApiKey {
  const { customerId, integrationId, integrationName, integrationAllowedModelIds, ...key } = row;
  const isIssuedByIntegration =
    integrationId !== null && integrationName !== null && customerId !== null;
  return {
    ...key,
    customer: isIssuedByIntegration
      ? {
          integrationId,
          integrationName,
          integrationAllowedModelIds: integrationAllowedModelIds ?? [],
          customerId,
        }
      : null,
  };
}

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

function snapshotPricingWindowOf(row: AttachedPricingWindowRow): SnapshotPricingWindow {
  return {
    name: row.name,
    timeZone: row.timeZone,
    ranges: row.ranges,
    isEnabled: row.isEnabled,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    windowPrices: {
      inputPrice: row.inputPrice,
      outputPrice: row.outputPrice,
      cacheReadPrice: row.cacheReadPrice,
      cacheWritePrice: row.cacheWritePrice,
    },
  };
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
