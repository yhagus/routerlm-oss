import { timestamp, uuid } from "drizzle-orm/pg-core";

/** A timezone-aware timestamp read and written as a `Date`. */
export const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** A UUID primary key PostgreSQL fills in on insert. */
export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => at("created_at").notNull().defaultNow();

export const updatedAt = () =>
  at("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
