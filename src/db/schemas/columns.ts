import { timestamp, uuid } from "drizzle-orm/pg-core";

export const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => at("created_at").notNull().defaultNow();

export const updatedAt = () =>
  at("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
