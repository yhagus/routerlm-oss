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

/** The names of the Models that still exist among `modelIds`, by id. */
export async function findModelNames(
  db: Database,
  modelIds: string[],
): Promise<Map<string, string>> {
  if (modelIds.length === 0) {
    return new Map();
  }
  const found = await db
    .select({ id: models.id, name: models.name })
    .from(models)
    .where(inArray(models.id, [...new Set(modelIds)]));
  return new Map(found.map((model) => [model.id, model.name]));
}
