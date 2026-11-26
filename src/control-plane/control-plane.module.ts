import { type DynamicModule, Module } from "@nestjs/common";
import { ApiKeysModule } from "@/api-keys/api-keys.module";
import { IntegrationsModule } from "@/integrations/integrations.module";
import { SnapshotModule } from "@/snapshot/snapshot.module";
import { SpendLimitsModule } from "@/spend-limits/spend-limits.module";
import { CommandHandlers } from "./commands/handlers";
import { ControlPlaneGrpcController } from "./control-plane-grpc.controller";
import { ControlPlaneController } from "./control-plane.controller";
import { QueryHandlers } from "./queries/handlers";

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
