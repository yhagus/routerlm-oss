import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { DASHBOARD_API_PREFIX } from "@/auth/decorators/dashboard-controller.decorator";
import { UnservedRouteMiddleware } from "./middleware/unserved-route.middleware";

@Module({})
export class ClosedDashboardApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(UnservedRouteMiddleware).forRoutes(DASHBOARD_API_PREFIX);
  }
}
