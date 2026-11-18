import { sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { models, routes } from "@/db/schemas/index.js";
import { truncateTables } from "./truncate.js";

/**
 * Deletes every User, Model, Route and Provider, and with them their Accounts
 * and Upstream Models. Usage Logs have no foreign key to them (ADR 0024), so
 * they are deleted by name.
 */
export async function deleteAllUpstreamData(db: Database): Promise<void> {
  await truncateTables(db, sql.raw("users, models, routes, providers, usage_logs"));
}

/** Creates a Model named `modelName` with one Route to the Upstream Model. */
export async function insertRouteTo(
  db: Database,
  upstreamModelId: string,
  modelName: string,
): Promise<void> {
  const [model] = await db.insert(models).values({ name: modelName }).returning({ id: models.id });
  await db.insert(routes).values({ modelId: model.id, upstreamModelId });
}
