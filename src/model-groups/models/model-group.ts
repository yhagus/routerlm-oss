import type { modelGroups } from '@/db/schemas';

export type ModelGroup = typeof modelGroups.$inferSelect;

export type ModelGroupSummary = ModelGroup & { modelCount: number };
