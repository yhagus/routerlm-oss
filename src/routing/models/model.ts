import type { modelGroups, models, providers, routes, upstreamModels } from '@/db/schemas';

export type ModelGroupRef = Pick<typeof modelGroups.$inferSelect, 'id' | 'name' | 'slug'>;

export type Model = typeof models.$inferSelect & { groups: ModelGroupRef[] };

export type ModelSummary = Pick<
  Model,
  'id' | 'name' | 'kind' | 'isEnabled' | 'createdAt' | 'groups'
> & {
  routeCount: number;
};

export type RouteSummary = Pick<
  typeof routes.$inferSelect,
  | 'id'
  | 'priority'
  | 'isEnabled'
  | 'connectTimeoutMs'
  | 'firstTokenTimeoutMs'
  | 'totalTimeoutMs'
  | 'parameterPolicyOverride'
> & {
  provider: Pick<typeof providers.$inferSelect, 'id' | 'slug' | 'name' | 'isEnabled'>;
  upstreamModel: Pick<
    typeof upstreamModels.$inferSelect,
    'id' | 'upstreamModelId' | 'capabilities' | 'isEnabled'
  >;
  enabledProviderAccountCount: number;
};

export type ModelDetail = Model & { routes: RouteSummary[] };
