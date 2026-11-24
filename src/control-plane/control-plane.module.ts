import { type DynamicModule, Module } from "@nestjs/common";
import { ApiKeysModule } from "@/api-keys/api-keys.module.js";
import { IntegrationsModule } from "@/integrations/integrations.module.js";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { SpendLimitsModule } from "@/spend-limits/spend-limits.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { ControlPlaneGrpcController } from "./control-plane-grpc.controller.js";
import { ControlPlaneController } from "./control-plane.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";

@Module({
  imports: [ApiKeysModule, IntegrationsModule, SnapshotModule, SpendLimitsModule],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class ControlPlaneModule {
  static overHttp(): DynamicModule {
    return { module: ControlPlaneModule, controllers: [ControlPlaneController] };
  }

  static overGrpc(): DynamicModule {
    return { module: ControlPlaneModule, controllers: [ControlPlaneGrpcController] };
  }
}
