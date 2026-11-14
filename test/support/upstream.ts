import { sql } from "drizzle-orm";
import type { Database } from "../../src/db/schemas/relations.js";
import { models, routes } from "../../src/db/schemas/index.js";

/** Deletes every User, Model, Route and Provider, and with them their Accounts and Upstream Models. */
export async function deleteAllUpstreamData(db: Database): Promise<void> {
  await db.execute(sql`truncate table users, models, routes, providers cascade`);
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
