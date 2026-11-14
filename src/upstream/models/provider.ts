import type { providers } from "../../db/schemas/index.js";

/** A Provider as the dashboard API returns it. It holds no secrets. */
export type Provider = typeof providers.$inferSelect;
