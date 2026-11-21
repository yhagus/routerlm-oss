import { Module } from "@nestjs/common";
import { ApiKeysModule } from "@/api-keys/api-keys.module.js";
import { IntegrationsModule } from "@/integrations/integrations.module.js";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { ControlPlaneController } from "./control-plane.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";

/**
 * The control plane an Integration manages its Customers' API Keys through
 * (ADR 0033). Its commands and queries are transport-neutral: they throw
 * ControlPlaneError, which each adapter maps (models/control-plane-error.ts).
 */
@Module({
  imports: [ApiKeysModule, IntegrationsModule, SnapshotModule],
  controllers: [ControlPlaneController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class ControlPlaneModule {}
