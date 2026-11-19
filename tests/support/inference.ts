import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth.js";
import type { Database } from "@/db/schemas/relations.js";
import {
  apiKeys,
  type AuthStyle,
  type Capability,
  type ModelKind,
  models,
  providerAccounts,
  providers,
  routes,
  type UpstreamProtocol,
  upstreamModels,
} from "@/db/schemas/index.js";
import type { CatalogProviderQuirks } from "@/catalog/schemas/catalog.schema.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";

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

/** What the Upstream Model behind a Route can take. */
export interface UpstreamModelLimits {
  /** Chat when not given; its Provider's one endpoint serves this Kind. */
  kind?: ModelKind;
  capabilities?: Capability[];
  /** 128 000 when not given. */
  contextSize?: number;
  /** None when not given. */
  maxOutputTokens?: number;
  /** Image sizes as the Provider writes them (`1024*1024`); any size when not given. */
  sizes?: string[];
  /** USD per generated image, by size tier (`1K`, `2K`). */
  pricePerImageBySize?: Record<string, number>;
  /** USD per million characters of synthesized speech. */
  pricePerMillionCharacters?: number;
}

export interface ModelOptions extends RouteTimeouts, UpstreamModelLimits {
  modelName: string;
  baseUrl: string;
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

/**
 * As insertOpenAiChatModel, for an image Model served by a dashscope-image
 * Provider. `baseUrl` is the endpoint's, such as `{fake origin}/api/v1`.
 */
export function insertDashScopeImageModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(
    app,
    db,
    { protocol: "dashscope-image", authStyle: "bearer" },
    { ...options, kind: "image", capabilities: [] },
  );
}

/** As addOpenAiChatRoute, for an image Route to a dashscope-image Provider of its own. */
export async function addDashScopeImageRoute(
  app: NestNodeApplication,
  db: Database,
  modelId: string,
  options: RouteOptions,
): Promise<Omit<InsertedModel, "modelId">> {
  const route = await insertRoute(
    db,
    app.get(ProviderKeyCipher),
    modelId,
    { protocol: "dashscope-image", authStyle: "bearer" },
    { ...options, kind: "image", capabilities: [] },
  );
  await app.get(SnapshotService).changed();
  return route;
}

/** As insertDashScopeImageModel, for a speech Model served by a dashscope-speech Provider. */
export function insertDashScopeSpeechModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(
    app,
    db,
    { protocol: "dashscope-speech", authStyle: "bearer" },
    { ...options, kind: "speech", capabilities: [] },
  );
}

/** As insertOpenAiChatModel, for an openai-responses Provider. */
export function insertOpenAiResponsesModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(app, db, { protocol: "openai-responses", authStyle: "bearer" }, options);
}

async function insertModel(
  app: NestNodeApplication,
  db: Database,
  speaks: { protocol: UpstreamProtocol; authStyle: AuthStyle },
  options: ModelOptions,
): Promise<InsertedModel> {
  const [model] = await db
    .insert(models)
    .values({ name: options.modelName, kind: options.kind })
    .returning({ id: models.id });
  const route = await insertRoute(db, app.get(ProviderKeyCipher), model.id, speaks, {
    ...options,
    providerSlug: `acme-${options.modelName}`,
    priority: 0,
  });
  await app.get(SnapshotService).changed();
  return { modelId: model.id, ...route };
}

export interface RouteOptions extends RouteTimeouts, UpstreamModelLimits {
  baseUrl: string;
  /** Unique per Provider. */
  providerSlug: string;
  priority: number;
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
      endpoints: [
        { kind: options.kind ?? "chat", protocol: speaks.protocol, baseUrl: options.baseUrl },
      ],
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
      kind: options.kind,
      capabilities: options.capabilities ?? ALL_CAPABILITIES,
      contextSize:
        options.kind === undefined || options.kind === "chat"
          ? (options.contextSize ?? 128_000)
          : null,
      maxOutputTokens: options.maxOutputTokens,
      sizes: options.sizes,
      pricePerImageBySize: options.pricePerImageBySize,
      pricePerMillionCharacters: options.pricePerMillionCharacters,
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

/**
 * Issues an API Key (restricted to `allowedModelIds` when given, with the row
 * id `id` when given) and returns it whole.
 */
export async function insertApiKey(
  app: NestNodeApplication,
  db: Database,
  allowedModelIds: string[] = [],
  id?: string,
): Promise<{ key: string; id: string }> {
  const { key, id: keyId, hash } = app.get(ApiKeyAuth).generate();
  const [row] = await db
    .insert(apiKeys)
    .values({ id, name: "client", keyId, hash, allowedModelIds })
    .returning({ id: apiKeys.id });
  await app.get(SnapshotService).changed();
  return { key, id: row.id };
}

/** Sets a Provider's quirks straight in the database, then refreshes the snapshot. */
export async function setProviderQuirks(
  app: NestNodeApplication,
  db: Database,
  providerId: string,
  quirks: CatalogProviderQuirks,
): Promise<void> {
  await db.update(providers).set({ quirks }).where(eq(providers.id, providerId));
  await app.get(SnapshotService).changed();
}

/** When the client fixtures say a response was created, in seconds. */
const FIXTURE_CREATED_AT = 1_794_700_000;

/**
 * A client fixture (`client-*`) as one request should get it: with the id
 * the gateway gave that request in place of the fixture's stand-in, and with
 * its creation time when the Protocol sends one.
 */
export function fixtureAsServed(
  fixture: string,
  standInRequestId: string,
  served: { requestId: string; createdAt?: number },
): string {
  const withServedId = fixture.replaceAll(standInRequestId, served.requestId);
  return served.createdAt === undefined
    ? withServedId
    : withServedId.replaceAll(String(FIXTURE_CREATED_AT), String(served.createdAt));
}
