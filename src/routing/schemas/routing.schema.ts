import { z } from 'zod';
import { hasAnyField, nothingToChange } from '@/libs/schemas/partial-update.schema';
import { MODEL_KINDS, type ParameterPolicy } from '@/db/schemas';
import {
  REASONING_EFFORTS,
  type ReasoningEffort,
  SERVICE_TIERS,
} from '@/inference/models/internal-format';

const capSchemas = {
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  maxOutputTokens: z.int().positive(),
  reasoningEffort: z.enum(REASONING_EFFORTS),
};
const parameterValuesSchema = z.strictObject({
  ...capSchemas,
  stopSequences: z.array(z.string().min(1)).min(1),
  serviceTier: z.enum(SERVICE_TIERS),
  voice: z.string().min(1),
  watermark: z.boolean(),
});
const CAPPED_PARAMETERS = z.object(capSchemas).keyof().options;

export const parameterPolicySchema = z
  .strictObject({
    defaults: parameterValuesSchema.partial().optional(),
    forced: parameterValuesSchema.partial().optional(),
    caps: z
      .strictObject({ ...capSchemas, reasoningBudgetTokens: z.int().positive() })
      .partial()
      .optional(),
    systemPrompt: z.string().optional(),
  })
  .superRefine((policy, context) => {
    const kinds = [
      ['default', policy.defaults],
      ['forced', policy.forced],
    ] as const;
    for (const [kind, values] of kinds) {
      for (const parameter of CAPPED_PARAMETERS) {
        const value = values?.[parameter];
        const cap = policy.caps?.[parameter];
        if (value !== undefined && cap !== undefined && rank(value) > rank(cap)) {
          context.addIssue({
            code: 'custom',
            path: [kind === 'default' ? 'defaults' : 'forced', parameter],
            message: `The ${kind} ${parameter} (${value}) is above its cap (${cap})`,
          });
        }
      }
    }
  }) satisfies z.ZodType<ParameterPolicy>;

function rank(value: number | ReasoningEffort): number {
  return typeof value === 'number' ? value : REASONING_EFFORTS.indexOf(value);
}

const modelFieldsSchema = z.strictObject({
  name: z.string().trim().min(1),
  isEnabled: z.boolean(),
  parameterPolicy: parameterPolicySchema,
  hasAutomaticCacheBreakpoints: z.boolean(),
});

export const newModelSchema = modelFieldsSchema.extend({
  kind: z.enum(MODEL_KINDS).optional(),
  isEnabled: z.boolean().optional(),
  parameterPolicy: parameterPolicySchema.optional(),
  hasAutomaticCacheBreakpoints: z.boolean().optional(),
});
export type NewModel = z.infer<typeof newModelSchema>;

export const modelChangesSchema = modelFieldsSchema.partial().refine(hasAnyField, nothingToChange);
export type ModelChanges = z.infer<typeof modelChangesSchema>;

const routeTimeoutMsSchema = z.int().positive().nullable();

const routeFieldsSchema = z.strictObject({
  upstreamModelId: z.uuid(),
  isEnabled: z.boolean(),
  connectTimeoutMs: routeTimeoutMsSchema,
  firstTokenTimeoutMs: routeTimeoutMsSchema,
  totalTimeoutMs: routeTimeoutMsSchema,
  parameterPolicyOverride: parameterPolicySchema.nullable(),
});

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

export const routeOrderSchema = z.strictObject({
  routeIds: z.array(z.uuid()).refine((routeIds) => new Set(routeIds).size === routeIds.length, {
    error: 'List each Route once',
  }),
});
export type RouteOrder = z.infer<typeof routeOrderSchema>;
