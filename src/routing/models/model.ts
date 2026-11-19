import type { models, providers, routes, upstreamModels } from "@/db/schemas/index.js";

/** A Model as the dashboard API returns it. */
export type Model = typeof models.$inferSelect;

/** A Model in the dashboard's list, with how many Routes it has. */
export type ModelSummary = Pick<Model, "id" | "name" | "kind" | "isEnabled" | "createdAt"> & {
  routeCount: number;
};

/** One Route as the Model page shows it: where it sends requests and whether anything can serve them. */
export type RouteSummary = Pick<
  typeof routes.$inferSelect,
  | "id"
  | "priority"
  | "isEnabled"
  | "connectTimeoutMs"
  | "firstTokenTimeoutMs"
  | "totalTimeoutMs"
  | "parameterPolicyOverride"
> & {
  provider: Pick<typeof providers.$inferSelect, "id" | "slug" | "name" | "isEnabled">;
  upstreamModel: Pick<
    typeof upstreamModels.$inferSelect,
    "id" | "upstreamModelId" | "capabilities" | "isEnabled"
  >;
  // Zero means the Route can never serve a request.
  enabledProviderAccountCount: number;
};

/** A Model with its Routes in the order the gateway tries them. */
export type ModelDetail = Model & { routes: RouteSummary[] };
