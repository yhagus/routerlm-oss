import type { providers } from "../../db/schema.js";

/** A Provider as the dashboard API returns it. It holds no secrets. */
export type Provider = typeof providers.$inferSelect;
