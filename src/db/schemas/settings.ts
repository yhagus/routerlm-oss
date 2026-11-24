import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { updatedAt } from "./columns.js";

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
