import { z } from "zod";
import type { ParameterPolicy } from "../../db/schemas/index.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "../../inference/models/internal-format.js";

// What the dashboard sends to create or change Models and their Routes.

const nothingToChange = { error: "Send at least one field to change" };
const hasAnyField = (changes: object): boolean => Object.keys(changes).length > 0;

// The widest ranges any upstream Protocol accepts; the upstream refuses what its model doesn't.
const capSchemas = {
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  maxOutputTokens: z.int().positive(),
  reasoningEffort: z.enum(REASONING_EFFORTS),
};
const parameterValuesSchema = z.strictObject({
  ...capSchemas,
  stopSequences: z.array(z.string().min(1)).min(1),
});
const CAPPED_PARAMETERS = z.object(capSchemas).keyof().options;

/** Kept unchanged: the system prompt is plain text, never a template. */
export const parameterPolicySchema = z
  .strictObject({
    defaults: parameterValuesSchema.partial().optional(),
    forced: parameterValuesSchema.partial().optional(),
    caps: z.strictObject(capSchemas).partial().optional(),
    systemPrompt: z.string().optional(),
  })
  .superRefine((policy, context) => {
    const kinds = [
      ["default", policy.defaults],
      ["forced", policy.forced],
    ] as const;
    for (const [kind, values] of kinds) {
      for (const parameter of CAPPED_PARAMETERS) {
        const value = values?.[parameter];
        const cap = policy.caps?.[parameter];
        if (value !== undefined && cap !== undefined && rank(value) > rank(cap)) {
          context.addIssue({
            code: "custom",
            path: [kind === "default" ? "defaults" : "forced", parameter],
            message: `The ${kind} ${parameter} (${value}) is above its cap (${cap})`,
          });
        }
      }
    }
  }) satisfies z.ZodType<ParameterPolicy>;

/** Where a capped value sits in its order: efforts by their place in REASONING_EFFORTS. */
function rank(value: number | ReasoningEffort): number {
  return typeof value === "number" ? value : REASONING_EFFORTS.indexOf(value);
}

const modelFieldsSchema = z.strictObject({
  // What clients send as `model`.
  name: z.string().trim().min(1),
  isEnabled: z.boolean(),
  parameterPolicy: parameterPolicySchema,
  hasAutomaticCacheBreakpoints: z.boolean(),
});

export const newModelSchema = modelFieldsSchema.extend({
  isEnabled: z.boolean().optional(),
  parameterPolicy: parameterPolicySchema.optional(),
  hasAutomaticCacheBreakpoints: z.boolean().optional(),
});
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
  // Null means the Model's Parameter Policy applies unchanged.
  parameterPolicyOverride: parameterPolicySchema.nullable(),
});

/** A new Route goes last; reorder to move it. */
export const newRouteSchema = routeFieldsSchema.extend({
  isEnabled: z.boolean().optional(),
  connectTimeoutMs: routeTimeoutMsSchema.optional(),
  firstTokenTimeoutMs: routeTimeoutMsSchema.optional(),
  totalTimeoutMs: routeTimeoutMsSchema.optional(),
  parameterPolicyOverride: parameterPolicySchema.nullable().optional(),
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
