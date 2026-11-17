import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { updatedAt } from "./columns.js";

/**
 * Values a User changed from the dashboard, one row per Setting. A Setting with
 * no row has its default; the keys, types and ranges live in
 * src/settings/models/setting-definitions.ts.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
