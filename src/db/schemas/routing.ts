import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns";
import type { ReasoningEffort, ServiceTier } from "@/inference/models/internal-format";
import { MODEL_KINDS, upstreamModels } from "./upstream";

export type ParameterValues = {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  stopSequences?: string[];
  serviceTier?: ServiceTier;
  voice?: string;
  watermark?: boolean;
};

export type ParameterCaps = Omit<
  ParameterValues,
  "stopSequences" | "serviceTier" | "voice" | "watermark"
> & {
  reasoningBudgetTokens?: number;
};

export type ParameterPolicy = {
  defaults?: ParameterValues;
  forced?: ParameterValues;
  caps?: ParameterCaps;
  systemPrompt?: string;
};

export const models = pgTable("models", {
  id: id(),
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: MODEL_KINDS }).notNull().default("chat"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  parameterPolicy: jsonb("parameter_policy").$type<ParameterPolicy>().notNull().default({}),
  hasAutomaticCacheBreakpoints: boolean("has_automatic_cache_breakpoints").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const routes = pgTable(
  "routes",
  {
    id: id(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    upstreamModelId: uuid("upstream_model_id")
      .notNull()
      .references(() => upstreamModels.id),
    priority: integer("priority").notNull().default(0),
    isEnabled: boolean("is_enabled").notNull().default(true),
    parameterPolicyOverride: jsonb("parameter_policy_override").$type<ParameterPolicy>(),
    connectTimeoutMs: integer("connect_timeout_ms"),
    firstTokenTimeoutMs: integer("first_token_timeout_ms"),
    totalTimeoutMs: integer("total_timeout_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("routes_model_id_priority_idx").on(table.modelId, table.priority)],
);
