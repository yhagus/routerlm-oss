import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { integrations } from "@/db/schemas/index.js";
import { integrationNotFound } from "./integration-not-found.js";

/** Throws the 404 unless an Integration has this id. */
export async function assertIntegrationExists(db: Database, id: string): Promise<void> {
  const [found] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(eq(integrations.id, id));
  if (!found) {
    throw integrationNotFound();
  }
}
