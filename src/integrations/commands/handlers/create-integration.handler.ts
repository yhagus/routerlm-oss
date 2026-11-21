import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import { assertModelsExist } from "@/libs/models/allowed-models.js";
import type { Database } from "@/db/schemas/relations.js";
import { integrations } from "@/db/schemas/index.js";
import type { CreatedIntegration } from "../../models/integration.js";
import { selectIntegrationSummaries } from "../../models/integration-summaries.js";
import { IntegrationSecretAuth } from "../../providers/integration-secret-auth.js";
import { CreateIntegrationCommand } from "../impl/create-integration.command.js";

@CommandHandler(CreateIntegrationCommand)
export class CreateIntegrationHandler implements ICommandHandler<CreateIntegrationCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly secretAuth: IntegrationSecretAuth,
  ) {}

  async execute({
    newIntegration,
    createdById,
  }: CreateIntegrationCommand): Promise<CreatedIntegration> {
    await assertModelsExist(this.db, newIntegration.allowedModelIds);
    const { key: secret, id: keyId, hash } = this.secretAuth.generate();
    const [created] = await this.db
      .insert(integrations)
      .values({
        name: newIntegration.name,
        keyId,
        hash,
        allowedModelIds: newIntegration.allowedModelIds,
        createdById,
      })
      .returning({ id: integrations.id });
    const [summary] = await selectIntegrationSummaries(this.db, eq(integrations.id, created.id));
    return { ...summary, secret };
  }
}
