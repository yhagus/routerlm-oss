import type { NestNodeApplication } from "@nestjs/platform-node";
import { ApiKeyAuth } from "../../src/api-keys/api-key-auth.js";
import type { Database } from "../../src/db/relations.js";
import {
  apiKeys,
  type AuthStyle,
  type Capability,
  models,
  providerAccounts,
  providers,
  routes,
  type UpstreamProtocol,
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
  providerId: string;
  providerAccountId: string;
}

/** A Route's timeout overrides, so tests need not wait out the defaults. */
export interface RouteTimeouts {
  connectTimeoutMs?: number;
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface ModelOptions extends RouteTimeouts {
  modelName: string;
  baseUrl: string;
  capabilities?: Capability[];
}

/**
 * Creates a Model served by one Route to an openai-chat Provider at
 * `baseUrl`, with one Provider Account, straight in the database, then
 * refreshes the snapshot as a dashboard write would.
 */
export function insertOpenAiChatModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(app, db, { protocol: "openai-chat", authStyle: "bearer" }, options);
}

/** As insertOpenAiChatModel, for an anthropic-messages Provider taking the key as x-api-key. */
export function insertAnthropicMessagesModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(app, db, { protocol: "anthropic-messages", authStyle: "x-api-key" }, options);
}

async function insertModel(
  app: NestNodeApplication,
  db: Database,
  speaks: { protocol: UpstreamProtocol; authStyle: AuthStyle },
  options: ModelOptions,
): Promise<InsertedModel> {
  const [model] = await db
    .insert(models)
    .values({ name: options.modelName })
    .returning({ id: models.id });
  const route = await insertRoute(db, app.get(ProviderKeyCipher), model.id, speaks, {
    ...options,
    providerSlug: `acme-${options.modelName}`,
    priority: 0,
  });
  await app.get(SnapshotService).changed();
  return { modelId: model.id, ...route };
}

export interface RouteOptions extends RouteTimeouts {
  baseUrl: string;
  /** Unique per Provider. */
  providerSlug: string;
  priority: number;
  capabilities?: Capability[];
}

/**
 * Adds a Route to an openai-chat Provider of its own (one Provider Account
 * with UPSTREAM_KEY) behind an existing Model, then refreshes the snapshot.
 */
export async function addOpenAiChatRoute(
  app: NestNodeApplication,
  db: Database,
  modelId: string,
  options: RouteOptions,
): Promise<Omit<InsertedModel, "modelId">> {
  const route = await insertRoute(
    db,
    app.get(ProviderKeyCipher),
    modelId,
    { protocol: "openai-chat", authStyle: "bearer" },
    options,
  );
  await app.get(SnapshotService).changed();
  return route;
}

async function insertRoute(
  db: Database,
  cipher: ProviderKeyCipher,
  modelId: string,
  speaks: { protocol: UpstreamProtocol; authStyle: AuthStyle },
  options: RouteOptions,
): Promise<Omit<InsertedModel, "modelId">> {
  const [provider] = await db
    .insert(providers)
    .values({
      slug: options.providerSlug,
      name: "Acme",
      protocol: speaks.protocol,
      baseUrl: options.baseUrl,
      authStyle: speaks.authStyle,
    })
    .returning({ id: providers.id });
  const [providerAccount] = await db
    .insert(providerAccounts)
    .values({
      providerId: provider.id,
      name: "main",
      encryptedKey: cipher.encrypt(UPSTREAM_KEY),
      keyLastFour: UPSTREAM_KEY.slice(-4),
    })
    .returning({ id: providerAccounts.id });
  const [upstreamModel] = await db
    .insert(upstreamModels)
    .values({
      providerId: provider.id,
      upstreamModelId: UPSTREAM_MODEL_ID,
      capabilities: options.capabilities ?? ALL_CAPABILITIES,
      contextSize: 128_000,
    })
    .returning({ id: upstreamModels.id });
  const [route] = await db
    .insert(routes)
    .values({
      modelId,
      upstreamModelId: upstreamModel.id,
      priority: options.priority,
      connectTimeoutMs: options.connectTimeoutMs,
      firstTokenTimeoutMs: options.firstTokenTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs,
    })
    .returning({ id: routes.id });
  return { routeId: route.id, providerId: provider.id, providerAccountId: providerAccount.id };
}

/**
 * Adds a Provider Account with its own `key` to a Provider, then refreshes
 * the snapshot. Returns its id.
 */
export async function addProviderAccount(
  app: NestNodeApplication,
  db: Database,
  providerId: string,
  options: { key: string; priority: number },
): Promise<string> {
  const [providerAccount] = await db
    .insert(providerAccounts)
    .values({
      providerId,
      name: `account ${options.priority}`,
      encryptedKey: app.get(ProviderKeyCipher).encrypt(options.key),
      keyLastFour: options.key.slice(-4),
      priority: options.priority,
    })
    .returning({ id: providerAccounts.id });
  await app.get(SnapshotService).changed();
  return providerAccount.id;
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
