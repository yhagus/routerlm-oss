import { z } from "zod";

// What the dashboard sends to create or change Models and their Routes.

const nothingToChange = { error: "Send at least one field to change" };
const hasAnyField = (changes: object): boolean => Object.keys(changes).length > 0;

const modelFieldsSchema = z.strictObject({
  // What clients send as `model`.
  name: z.string().trim().min(1),
  isEnabled: z.boolean(),
});

export const newModelSchema = modelFieldsSchema.extend({ isEnabled: z.boolean().optional() });
export type NewModel = z.infer<typeof newModelSchema>;

export const modelChangesSchema = modelFieldsSchema.partial().refine(hasAnyField, nothingToChange);
export type ModelChanges = z.infer<typeof modelChangesSchema>;

// Null means the gateway default (spec "Fallback": 10 s, 60 s, 10 min).
const routeTimeoutMsSchema = z.int().positive().nullable();

const routeFieldsSchema = z.strictObject({
  upstreamModelId: z.uuid(),
  isEnabled: z.boolean(),
  connectTimeoutMs: routeTimeoutMsSchema,
  firstTokenTimeoutMs: routeTimeoutMsSchema,
  totalTimeoutMs: routeTimeoutMsSchema,
});

/** A new Route goes last; reorder to move it. */
export const newRouteSchema = routeFieldsSchema.extend({
  isEnabled: z.boolean().optional(),
  connectTimeoutMs: routeTimeoutMsSchema.optional(),
  firstTokenTimeoutMs: routeTimeoutMsSchema.optional(),
  totalTimeoutMs: routeTimeoutMsSchema.optional(),
});
export type NewRoute = z.infer<typeof newRouteSchema>;

export const routeChangesSchema = routeFieldsSchema.partial().refine(hasAnyField, nothingToChange);
export type RouteChanges = z.infer<typeof routeChangesSchema>;

/** Every Route of the Model, each once, first to try first. */
export const routeOrderSchema = z.strictObject({
  routeIds: z.array(z.uuid()).refine((routeIds) => new Set(routeIds).size === routeIds.length, {
    error: "List each Route once",
  }),
});
export type RouteOrder = z.infer<typeof routeOrderSchema>;
