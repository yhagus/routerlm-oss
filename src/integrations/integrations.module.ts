import { Module } from "@nestjs/common";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationSecretAuth } from "./providers/integration-secret-auth.js";
import { QueryHandlers } from "./queries/handlers/index.js";

@Module({
  imports: [SnapshotModule],
  controllers: [IntegrationsController],
  providers: [IntegrationSecretAuth, ...CommandHandlers, ...QueryHandlers],
  exports: [IntegrationSecretAuth],
})
export class IntegrationsModule {}
