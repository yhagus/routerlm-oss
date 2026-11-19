import { NotFoundException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeyRotations, apiKeys, users } from "@/db/schemas/index.js";
import type { ApiKeyRotation } from "../../models/api-key.js";
import { ListApiKeyRotationsQuery } from "../impl/list-api-key-rotations.query.js";

@QueryHandler(ListApiKeyRotationsQuery)
export class ListApiKeyRotationsHandler implements IQueryHandler<ListApiKeyRotationsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ apiKeyId }: ListApiKeyRotationsQuery): Promise<ApiKeyRotation[]> {
    const [apiKey] = await this.db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId));
    if (!apiKey) {
      throw new NotFoundException("API Key not found");
    }
    const rows = await this.db
      .select({
        id: apiKeyRotations.id,
        rotatedAt: apiKeyRotations.rotatedAt,
        rotatorId: users.id,
        rotatorEmail: users.email,
        previousKeyId: apiKeyRotations.previousKeyId,
        newKeyId: apiKeyRotations.newKeyId,
      })
      .from(apiKeyRotations)
      .leftJoin(users, eq(apiKeyRotations.rotatedById, users.id))
      .where(eq(apiKeyRotations.apiKeyId, apiKeyId))
      .orderBy(desc(apiKeyRotations.rotatedAt));
    return rows.map(({ rotatorId, rotatorEmail, ...row }) => ({
      ...row,
      rotatedBy: rotatorId && rotatorEmail ? { id: rotatorId, email: rotatorEmail } : null,
    }));
  }
}
