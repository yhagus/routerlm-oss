import type { NestNodeApplication } from "@nestjs/platform-node";
import { ApiKeyAuth } from "../../src/api-keys/api-key-auth.js";
import type { Database } from "../../src/db/relations.js";
import {
  apiKeys,
  type Capability,
  models,
  providerAccounts,
  providers,
  routes,
  upstreamModels,
} from "../../src/db/schema.js";
import { SnapshotService } from "../../src/snapshot/snapshot.service.js";
import { ProviderKeyCipher } from "../../src/upstream/provider-key-cipher.js";

/** The Provider Account key the fake upstream expects; it must never reach a client or a log. */
export const UPSTREAM_KEY = "sk-upstream-secret-0123456789";
export const UPSTREAM_MODEL_ID = "acme-large-2026";
export const ALL_CAPABILITIES: Capability[] = ["vision", "tools", "reasoning", "structured-output"];

export interface InsertedModel {
  modelId: string;
  routeId: string;
}

/**
 * Creates a Model served by one Route to an openai-chat Provider at
 * `baseUrl`, with one Provider Account, straight in the database, then
 * refreshes the snapshot as a dashboard write would.
 */
export async function insertOpenAiChatModel(
  app: NestNodeApplication,
  db: Database,
  options: {
    modelName: string;
    baseUrl: string;
    capabilities?: Capability[];
    totalTimeoutMs?: number;
  },
): Promise<InsertedModel> {
  const [provider] = await db
    .insert(providers)
    .values({
      slug: `acme-${options.modelName}`,
      name: "Acme",
      protocol: "openai-chat",
      baseUrl: options.baseUrl,
      authStyle: "bearer",
    })
    .returning({ id: providers.id });
  await db.insert(providerAccounts).values({
    providerId: provider.id,
    name: "main",
    encryptedKey: app.get(ProviderKeyCipher).encrypt(UPSTREAM_KEY),
    keyLastFour: UPSTREAM_KEY.slice(-4),
  });
  const [upstreamModel] = await db
    .insert(upstreamModels)
    .values({
      providerId: provider.id,
      upstreamModelId: UPSTREAM_MODEL_ID,
      capabilities: options.capabilities ?? ALL_CAPABILITIES,
      contextSize: 128_000,
    })
    .returning({ id: upstreamModels.id });
  const [model] = await db
    .insert(models)
    .values({ name: options.modelName })
    .returning({ id: models.id });
  const [route] = await db
    .insert(routes)
    .values({
      modelId: model.id,
      upstreamModelId: upstreamModel.id,
      totalTimeoutMs: options.totalTimeoutMs,
    })
    .returning({ id: routes.id });
  await app.get(SnapshotService).changed();
  return { modelId: model.id, routeId: route.id };
}

/** Issues an API Key (restricted to `allowedModelIds` when given) and returns it whole. */
export async function insertApiKey(
  app: NestNodeApplication,
  db: Database,
  allowedModelIds: string[] = [],
): Promise<{ key: string; id: string }> {
  const { key, id: keyId, hash } = app.get(ApiKeyAuth).generate();
  const [row] = await db
    .insert(apiKeys)
    .values({ name: "client", keyId, hash, allowedModelIds })
    .returning({ id: apiKeys.id });
  await app.get(SnapshotService).changed();
  return { key, id: row.id };
}
