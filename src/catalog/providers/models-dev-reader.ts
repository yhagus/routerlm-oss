import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpClient, HttpClientError, InjectHttpClient } from "@nestjs/http-client";
import { z } from "zod";
import type { Env } from "@/config/schemas/env.schema.js";
import type { ModelsDevModel, ModelsDevSnapshot } from "@/catalog/models/models-dev.js";
import { MODELS_DEV_HTTP_CLIENT } from "./models-dev-http-client.js";

const NEWEST_MODEL_COUNT = 5;
const CACHE_LIFETIME_MS = 6 * 60 * 60 * 1000;

const modelsDevApiSchema = z.record(
  z.string(),
  z.looseObject({
    models: z
      .record(
        z.string(),
        z.looseObject({ id: z.string(), name: z.string(), release_date: z.string().optional() }),
      )
      .optional(),
  }),
);

@Injectable()
export class ModelsDevReader {
  private readonly logger = new Logger(ModelsDevReader.name);
  private cached: ModelsDevSnapshot | undefined;

  constructor(
    @InjectHttpClient(MODELS_DEV_HTTP_CLIENT) private readonly http: HttpClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async readNewestModels(): Promise<ModelsDevSnapshot | null> {
    if (this.cached && Date.now() - this.cached.checkedAt.getTime() < CACHE_LIFETIME_MS) {
      return this.cached;
    }

    const body = await this.fetchApi();
    if (body === undefined) return null;
    const parsed = modelsDevApiSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`models.dev answered in an unknown shape: ${parsed.error.message}`);
      return null;
    }

    const newestModelsByProviderId = new Map<string, ModelsDevModel[]>();
    for (const [providerId, provider] of Object.entries(parsed.data)) {
      newestModelsByProviderId.set(providerId, newestModelsOf(provider.models ?? {}));
    }
    this.cached = { checkedAt: new Date(), newestModelsByProviderId };
    return this.cached;
  }

  private async fetchApi(): Promise<unknown> {
    const url = this.config.get("MODELS_DEV_API_URL", { infer: true });
    try {
      const response = await this.http.get(url, { headers: { accept: "application/json" } });
      return response.data;
    } catch (error) {
      if (!(error instanceof HttpClientError)) throw error;
      this.logger.warn(`models.dev could not be read: ${error.message}`);
      return undefined;
    }
  }
}

function newestModelsOf(
  models: Record<string, { id: string; name: string; release_date?: string }>,
): ModelsDevModel[] {
  return Object.values(models)
    .flatMap((model) =>
      model.release_date === undefined
        ? []
        : [{ id: model.id, name: model.name, releaseDate: model.release_date }],
    )
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.id.localeCompare(b.id))
    .slice(0, NEWEST_MODEL_COUNT);
}
