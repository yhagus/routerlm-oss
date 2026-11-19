import { BadRequestException } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { models } from "@/db/schemas/index.js";

/** Refuses allowed Model ids that name no Model. */
export async function assertModelsExist(db: Database, modelIds: string[]): Promise<void> {
  if (modelIds.length === 0) {
    return;
  }
  const found = await db.select({ id: models.id }).from(models).where(inArray(models.id, modelIds));
  if (found.length !== modelIds.length) {
    throw new BadRequestException("Unknown Model in allowedModelIds");
  }
}
