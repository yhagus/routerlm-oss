import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { integrations } from '@/db/schemas';
import { integrationNotFound } from './integration-not-found';

export async function assertIntegrationExists(db: Database, id: string): Promise<void> {
  const [found] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(eq(integrations.id, id));
  if (!found) {
    throw integrationNotFound();
  }
}
