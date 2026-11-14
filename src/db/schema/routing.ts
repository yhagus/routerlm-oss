import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.js";
import { upstreamModels } from "./upstream.js";

// Routing: the Models the gateway exposes and the Routes that serve them.

/** Request parameters keyed by their name in the internal request format (ADR 0002). */
export type ParameterValues = Record<string, unknown>;

/**
 * What an operator sets on a Model, or overrides on a Route. Every part is
 * optional; an empty object changes nothing.
 */
export type ParameterPolicy = {
  /** Fill parameters the client omitted. */
  defaults?: ParameterValues;
  /** Replace whatever the client sent. */
  forced?: ParameterValues;
  /** Upper bounds for numeric parameters; larger client values are clamped. */
  caps?: Record<string, number>;
  /** Static text placed first in the system prompt. Never per-request values. */
  systemPrompt?: string;
};

export const models = pgTable("models", {
  id: id(),
  // What clients send as `model`.
  name: text("name").notNull().unique(),
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
    // No cascade: an Upstream Model still used by a Route can't be deleted.
    upstreamModelId: uuid("upstream_model_id")
      .notNull()
      .references(() => upstreamModels.id),
    // Lower runs first.
    priority: integer("priority").notNull().default(0),
    isEnabled: boolean("is_enabled").notNull().default(true),
    // Null means the Model's Parameter Policy applies unchanged.
    parameterPolicyOverride: jsonb("parameter_policy_override").$type<ParameterPolicy>(),
    // Null means the gateway default (10 s connect, 60 s first token, 10 min total).
    connectTimeoutMs: integer("connect_timeout_ms"),
    firstTokenTimeoutMs: integer("first_token_timeout_ms"),
    totalTimeoutMs: integer("total_timeout_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("routes_model_id_priority_idx").on(table.modelId, table.priority)],
);
