import { defineRelations } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

// Declare relations between the tables in schema.ts here (r.one / r.many).
export const relations = defineRelations(schema, () => ({}));

/** Inject with `@InjectDrizzle() private readonly db: Database`. */
export type Database = NodePgDatabase<typeof relations>;
