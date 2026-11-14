import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Database } from "../db/relations.js";
import { apiKeys, models, users } from "../db/schema.js";
import type { ApiKeySummary, CreatedApiKey, ModelChoice } from "./api-key.js";
import { ApiKeyAuth } from "./api-key-auth.js";
import type { NewApiKey } from "./api-keys.schemas.js";

/**
 * Creates, lists and revokes API Keys. Every change to which keys are valid
 * goes through `createApiKey` and `revokeApiKey`.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly apiKeyAuth: ApiKeyAuth,
  ) {}

  listModelChoices(): Promise<ModelChoice[]> {
    return this.db
      .select({ id: models.id, name: models.name })
      .from(models)
      .orderBy(asc(models.name));
  }

  /** Creates a key and returns it whole, the only time it is ever shown. Only its hash is stored. */
  async createApiKey(newKey: NewApiKey, createdById: string): Promise<CreatedApiKey> {
    await this.assertModelsExist(newKey.allowedModelIds);
    const { key, id: keyId, hash } = this.apiKeyAuth.generate();
    const [created] = await this.db
      .insert(apiKeys)
      .values({
        name: newKey.name,
        keyId,
        hash,
        createdById,
        expiresAt: newKey.expiresAt,
        allowedModelIds: newKey.allowedModelIds,
      })
      .returning({ id: apiKeys.id });
    const [summary] = await this.selectSummaries(eq(apiKeys.id, created.id));
    return { ...summary, key };
  }

  /** Newest first. */
  listApiKeys(): Promise<ApiKeySummary[]> {
    return this.selectSummaries();
  }

  /** Refuses the key from now on. Revoking a revoked key keeps its first revocation time. */
  async revokeApiKey(id: string): Promise<void> {
    const revoked = await this.db
      .update(apiKeys)
      .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` })
      .where(eq(apiKeys.id, id))
      .returning({ id: apiKeys.id });
    if (revoked.length === 0) {
      throw new NotFoundException("API Key not found");
    }
  }

  private async assertModelsExist(modelIds: string[]): Promise<void> {
    if (modelIds.length === 0) {
      return;
    }
    const found = await this.db
      .select({ id: models.id })
      .from(models)
      .where(inArray(models.id, modelIds));
    if (found.length !== modelIds.length) {
      throw new BadRequestException("Unknown Model in allowedModelIds");
    }
  }

  private async selectSummaries(where?: SQL): Promise<ApiKeySummary[]> {
    const rows = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyId: apiKeys.keyId,
        creatorId: users.id,
        creatorEmail: users.email,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        allowedModelIds: apiKeys.allowedModelIds,
      })
      .from(apiKeys)
      .leftJoin(users, eq(apiKeys.createdById, users.id))
      .where(where)
      .orderBy(desc(apiKeys.createdAt));
    const modelNames = await this.findModelNames(rows.flatMap((row) => row.allowedModelIds));
    return rows.map(({ creatorId, creatorEmail, allowedModelIds, ...row }) => ({
      ...row,
      createdBy: creatorId && creatorEmail ? { id: creatorId, email: creatorEmail } : null,
      allowedModels: allowedModelIds.map((id) => ({ id, name: modelNames.get(id) ?? null })),
    }));
  }

  private async findModelNames(modelIds: string[]): Promise<Map<string, string>> {
    if (modelIds.length === 0) {
      return new Map();
    }
    const found = await this.db
      .select({ id: models.id, name: models.name })
      .from(models)
      .where(inArray(models.id, [...new Set(modelIds)]));
    return new Map(found.map((model) => [model.id, model.name]));
  }
}
