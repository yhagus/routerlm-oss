import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import { assertModelGroupsExist, assertModelsExist } from '@/libs/models/allowed-models';
import type { Database } from '@/db/schemas/relations';
import { integrations } from '@/db/schemas';
import type { CreatedIntegration } from '@/integrations/models/integration';
import { selectIntegrationSummaries } from '@/integrations/models/integration-summaries';
import { IntegrationSecretAuth } from '@/integrations/providers/integration-secret-auth';
import { CreateIntegrationCommand } from '@/integrations/commands/impl/create-integration.command';

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
    await assertModelGroupsExist(this.db, newIntegration.allowedModelGroupIds);
    const { key: secret, id: keyId, hash } = this.secretAuth.generate();
    const [created] = await this.db
      .insert(integrations)
      .values({
        name: newIntegration.name,
        keyId,
        hash,
        allowedModelIds: newIntegration.allowedModelIds,
        allowedModelGroupIds: newIntegration.allowedModelGroupIds,
        directUpstreamAccess: newIntegration.directUpstreamAccess,
        createdById,
      })
      .returning({ id: integrations.id });
    const [summary] = await selectIntegrationSummaries(this.db, eq(integrations.id, created.id));
    return { ...summary, secret };
  }
}
