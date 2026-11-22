import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { integrationRotations, users } from "@/db/schemas/index.js";
import type { IntegrationRotation } from "@/integrations/models/integration.js";
import { assertIntegrationExists } from "@/integrations/models/integration-exists.js";
import { ListIntegrationRotationsQuery } from "@/integrations/queries/impl/list-integration-rotations.query.js";

@QueryHandler(ListIntegrationRotationsQuery)
export class ListIntegrationRotationsHandler implements IQueryHandler<ListIntegrationRotationsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ integrationId }: ListIntegrationRotationsQuery): Promise<IntegrationRotation[]> {
    await assertIntegrationExists(this.db, integrationId);
    const rows = await this.db
      .select({
        id: integrationRotations.id,
        rotatedAt: integrationRotations.rotatedAt,
        rotatorId: users.id,
        rotatorEmail: users.email,
        previousKeyId: integrationRotations.previousKeyId,
        newKeyId: integrationRotations.newKeyId,
      })
      .from(integrationRotations)
      .leftJoin(users, eq(integrationRotations.rotatedById, users.id))
      .where(eq(integrationRotations.integrationId, integrationId))
      .orderBy(desc(integrationRotations.rotatedAt));
    return rows.map(({ rotatorId, rotatorEmail, ...row }) => ({
      ...row,
      rotatedBy: rotatorId && rotatorEmail ? { id: rotatorId, email: rotatorEmail } : null,
    }));
  }
}
