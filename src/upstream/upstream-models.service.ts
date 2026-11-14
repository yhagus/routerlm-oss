import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, eq } from "drizzle-orm";
import {
  FOREIGN_KEY_VIOLATION,
  hasPostgresErrorCode,
  UNIQUE_VIOLATION,
} from "../db/postgres-errors.js";
import type { Database } from "../db/relations.js";
import { upstreamModels } from "../db/schema.js";
import { deleteUnlessRouted } from "./routed-models.js";
import { UpstreamChangeSignal } from "./upstream-change-signal.js";
import type { NewUpstreamModel, UpstreamModelChanges } from "./upstream.schemas.js";

/** An Upstream Model as the dashboard API returns it. */
export type UpstreamModel = typeof upstreamModels.$inferSelect;

@Injectable()
export class UpstreamModelsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly changeSignal: UpstreamChangeSignal,
  ) {}

  listUpstreamModels(): Promise<UpstreamModel[]> {
    return this.db
      .select()
      .from(upstreamModels)
      .orderBy(asc(upstreamModels.providerId), asc(upstreamModels.upstreamModelId));
  }

  async createUpstreamModel(newUpstreamModel: NewUpstreamModel): Promise<UpstreamModel> {
    try {
      const [created] = await this.db.insert(upstreamModels).values(newUpstreamModel).returning();
      await this.changeSignal.changed();
      return created;
    } catch (error) {
      throw toUpstreamModelWriteError(error, newUpstreamModel.upstreamModelId);
    }
  }

  async updateUpstreamModel(
    upstreamModelId: string,
    changes: UpstreamModelChanges,
  ): Promise<UpstreamModel> {
    let updated: UpstreamModel | undefined;
    try {
      [updated] = await this.db
        .update(upstreamModels)
        .set(changes)
        .where(eq(upstreamModels.id, upstreamModelId))
        .returning();
    } catch (error) {
      throw toUpstreamModelWriteError(error, changes.upstreamModelId);
    }
    if (!updated) {
      throw new NotFoundException("Upstream Model not found");
    }
    await this.changeSignal.changed();
    return updated;
  }

  async deleteUpstreamModel(upstreamModelId: string): Promise<void> {
    const [upstreamModel] = await this.db
      .select({ name: upstreamModels.upstreamModelId })
      .from(upstreamModels)
      .where(eq(upstreamModels.id, upstreamModelId));
    if (!upstreamModel) {
      throw new NotFoundException("Upstream Model not found");
    }
    await deleteUnlessRouted(
      this.db,
      `The Upstream Model ${upstreamModel.name}`,
      eq(upstreamModels.id, upstreamModelId),
      async () => {
        await this.db.delete(upstreamModels).where(eq(upstreamModels.id, upstreamModelId));
      },
    );
    await this.changeSignal.changed();
  }
}

function toUpstreamModelWriteError(error: unknown, providerModelName: string | undefined): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(
      `The Provider already has an Upstream Model named "${providerModelName ?? ""}"`,
    );
  }
  if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
    return new NotFoundException("Provider not found");
  }
  return error;
}
