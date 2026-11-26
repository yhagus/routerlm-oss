import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth";
import type { Database } from "@/db/schemas/relations";
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
} from "@/db/schemas";
import type { CatalogProviderQuirks } from "@/catalog/schemas/catalog.schema";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher";

export const UPSTREAM_KEY = "sk-upstream-secret-0123456789";
export const UPSTREAM_MODEL_ID = "acme-large-2026";
export const ALL_CAPABILITIES: Capability[] = ["vision", "tools", "reasoning", "structured-output"];

export interface InsertedModel {
  modelId: string;
  routeId: string;
  providerId: string;
  providerAccountId: string;
}

export interface RouteTimeouts {
  connectTimeoutMs?: number;
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface UpstreamModelLimits {
  kind?: ModelKind;
  capabilities?: Capability[];
  contextSize?: number;
  maxOutputTokens?: number;
  sizes?: string[];
  pricePerImageBySize?: Record<string, number>;
  resolutions?: string[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  pricePerSecondByResolution?: Record<string, number>;
  pricePerInputImage?: number;
  maxInputImages?: number;
  pricePerMillionCharacters?: number;
  pricePerAudioSecond?: number;
}

export interface ModelOptions extends RouteTimeouts, UpstreamModelLimits {
  modelName: string;
  baseUrl: string;
}

export function insertOpenAiChatModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(app, db, { protocol: "openai-chat", authStyle: "bearer" }, options);
}

export function insertAnthropicMessagesModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(app, db, { protocol: "anthropic-messages", authStyle: "x-api-key" }, options);
}

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

export function insertDashScopeVideoModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(
    app,
    db,
    { protocol: "dashscope-video", authStyle: "bearer" },
    { capabilities: ["text-to-video"], ...options, kind: "video" },
  );
}

export async function addDashScopeVideoRoute(
  app: NestNodeApplication,
  db: Database,
  modelId: string,
  options: RouteOptions,
): Promise<Omit<InsertedModel, "modelId">> {
  const route = await insertRoute(
    db,
    app.get(ProviderKeyCipher),
    modelId,
    { protocol: "dashscope-video", authStyle: "bearer" },
    { capabilities: ["text-to-video"], ...options, kind: "video" },
  );
  await app.get(SnapshotService).changed();
  return route;
}

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

export function insertDashScopeTranscriptionModel(
  app: NestNodeApplication,
  db: Database,
  options: ModelOptions,
): Promise<InsertedModel> {
  return insertModel(
    app,
    db,
    { protocol: "dashscope-transcription", authStyle: "bearer" },
    { ...options, kind: "transcription", capabilities: [] },
  );
}

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
  providerSlug: string;
  priority: number;
}

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
      resolutions: options.resolutions,
      minDurationSeconds: options.minDurationSeconds,
      maxDurationSeconds: options.maxDurationSeconds,
      pricePerSecondByResolution: options.pricePerSecondByResolution,
      pricePerInputImage: options.pricePerInputImage,
      maxInputImages: options.maxInputImages,
      pricePerMillionCharacters: options.pricePerMillionCharacters,
      pricePerAudioSecond: options.pricePerAudioSecond,
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

export async function setProviderQuirks(
  app: NestNodeApplication,
  db: Database,
  providerId: string,
  quirks: CatalogProviderQuirks,
): Promise<void> {
  await db.update(providers).set({ quirks }).where(eq(providers.id, providerId));
  await app.get(SnapshotService).changed();
}

const FIXTURE_CREATED_AT = 1_794_700_000;

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
