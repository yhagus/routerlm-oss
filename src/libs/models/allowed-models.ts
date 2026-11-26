import { BadRequestException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { modelGroupMembers, modelGroups, models } from '@/db/schemas';

export interface ModelAllowance {
  allowedModelIds: string[];
  allowedModelGroupIds: string[];
}

export const EVERY_MODEL: ModelAllowance = { allowedModelIds: [], allowedModelGroupIds: [] };

export interface GroupedModel {
  id: string;
  groupIds: string[];
}

export function allowsEveryModel(allowance: ModelAllowance): boolean {
  return allowance.allowedModelIds.length === 0 && allowance.allowedModelGroupIds.length === 0;
}

export function allowsModel(allowance: ModelAllowance, model: GroupedModel): boolean {
  return (
    allowsEveryModel(allowance) ||
    allowance.allowedModelIds.includes(model.id) ||
    model.groupIds.some((groupId) => allowance.allowedModelGroupIds.includes(groupId))
  );
}

export async function assertModelsExist(db: Database, modelIds: string[]): Promise<void> {
  if (modelIds.length === 0) {
    return;
  }
  const found = await db.select({ id: models.id }).from(models).where(inArray(models.id, modelIds));
  if (found.length !== modelIds.length) {
    throw new BadRequestException('Unknown Model in allowedModelIds');
  }
}

export async function assertModelGroupsExist(db: Database, modelGroupIds: string[]): Promise<void> {
  if (modelGroupIds.length === 0) {
    return;
  }
  const found = await db
    .select({ id: modelGroups.id })
    .from(modelGroups)
    .where(inArray(modelGroups.id, modelGroupIds));
  if (found.length !== modelGroupIds.length) {
    throw new BadRequestException('Unknown Model Group in allowedModelGroupIds');
  }
}

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

export async function findModelGroupNames(
  db: Database,
  modelGroupIds: string[],
): Promise<Map<string, string>> {
  if (modelGroupIds.length === 0) {
    return new Map();
  }
  const found = await db
    .select({ id: modelGroups.id, name: modelGroups.name })
    .from(modelGroups)
    .where(inArray(modelGroups.id, [...new Set(modelGroupIds)]));
  return new Map(found.map((group) => [group.id, group.name]));
}

export async function findModelIdsInGroups(
  db: Database,
  modelGroupIds: string[],
): Promise<Set<string>> {
  if (modelGroupIds.length === 0) {
    return new Set();
  }
  const found = await db
    .select({ modelId: modelGroupMembers.modelId })
    .from(modelGroupMembers)
    .where(inArray(modelGroupMembers.modelGroupId, modelGroupIds));
  return new Set(found.map((membership) => membership.modelId));
}
