import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { integrationRotations, integrations } from "@/db/schemas/index.js";
import type { CreatedIntegration } from "../../models/integration.js";
import { integrationNotFound } from "../../models/integration-not-found.js";
import { selectIntegrationSummaries } from "../../models/integration-summaries.js";
import { IntegrationSecretAuth } from "../../providers/integration-secret-auth.js";
import { RotateIntegrationSecretCommand } from "../impl/rotate-integration-secret.command.js";

@CommandHandler(RotateIntegrationSecretCommand)
export class RotateIntegrationSecretHandler implements ICommandHandler<RotateIntegrationSecretCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly secretAuth: IntegrationSecretAuth,
  ) {}

  async execute({ id, rotatedById }: RotateIntegrationSecretCommand): Promise<CreatedIntegration> {
    const { key: secret, id: keyId, hash } = this.secretAuth.generate();
    await this.db.transaction(async (tx) => {
      // Locked so a concurrent rotation can't record the same previous secret.
      const [current] = await tx
        .select({ keyId: integrations.keyId })
        .from(integrations)
        .where(eq(integrations.id, id))
        .for("update");
      if (!current) {
        throw integrationNotFound();
      }
      await tx.update(integrations).set({ keyId, hash }).where(eq(integrations.id, id));
      await tx
        .insert(integrationRotations)
        .values({ integrationId: id, rotatedById, previousKeyId: current.keyId, newKeyId: keyId });
    });
    const [summary] = await selectIntegrationSummaries(this.db, eq(integrations.id, id));
    return { ...summary, secret };
  }
}
