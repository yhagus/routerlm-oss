import { type DynamicModule, Module } from "@nestjs/common";
import { ApiKeysModule } from "@/api-keys/api-keys.module.js";
import { IntegrationsModule } from "@/integrations/integrations.module.js";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { SpendLimitsModule } from "@/spend-limits/spend-limits.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { ControlPlaneGrpcController } from "./control-plane-grpc.controller.js";
import { ControlPlaneController } from "./control-plane.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";

/**
 * The control plane an Integration manages its Customers' API Keys through
 * (ADR 0033). Its commands and queries are transport-neutral: they throw
 * ControlPlaneError, which each adapter maps (models/control-plane-error.ts).
 * Each process imports it with the adapter it serves.
 */
@Module({
  imports: [ApiKeysModule, IntegrationsModule, SnapshotModule, SpendLimitsModule],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class ControlPlaneModule {
  /** The HTTP/JSON adapter, on the gateway's own port. */
  static overHttp(): DynamicModule {
    return { module: ControlPlaneModule, controllers: [ControlPlaneController] };
  }

  /** The gRPC adapter, in the worker when CONTROL_PLANE_PORT is set. */
  static overGrpc(): DynamicModule {
    return { module: ControlPlaneModule, controllers: [ControlPlaneGrpcController] };
  }
}
