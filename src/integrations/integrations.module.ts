import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module";
import { CommandHandlers } from "./commands/handlers";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationSecretAuth } from "./providers/integration-secret-auth";
import { QueryHandlers } from "./queries/handlers";

@Module({
  imports: [SnapshotModule],
  controllers: [IntegrationsController],
  providers: [IntegrationSecretAuth, ...CommandHandlers, ...QueryHandlers],
  exports: [IntegrationSecretAuth],
})
export class IntegrationsModule {}
