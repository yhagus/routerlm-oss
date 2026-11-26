import type { models, providers, routes, upstreamModels } from '@/db/schemas';

export type Model = typeof models.$inferSelect;

export type ModelSummary = Pick<Model, 'id' | 'name' | 'kind' | 'isEnabled' | 'createdAt'> & {
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
