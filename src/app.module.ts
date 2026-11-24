import {
  type DynamicModule,
  Module,
  type ModuleMetadata,
  StandardSchemaValidationPipe,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { APP_PIPE } from "@nestjs/core";
import { ApiKeysModule } from "@/api-keys/api-keys.module.js";
import { IntegrationsModule } from "@/integrations/integrations.module.js";
import { AppController } from "@/app.controller.js";
import { AuthModule } from "@/auth/auth.module.js";
import { ClosedDashboardApiModule } from "@/backend-roles/closed-dashboard-api.module.js";
import { ControlPlaneModule } from "@/control-plane/control-plane.module.js";
import { CatalogGapsModule } from "@/catalog/catalog-gaps.module.js";
import { type BackendRole, type Env, envSchema } from "@/config/schemas/env.schema.js";
import { relations } from "@/db/schemas/relations.js";
import { ErrorCapturesModule } from "@/error-captures/error-captures.module.js";
import { HealthModule } from "@/health/health.module.js";
import { LibsModule } from "@/libs/libs.module.js";
import { InferenceModule } from "@/inference/inference.module.js";
import { OverviewModule } from "@/overview/overview.module.js";
import { PlaygroundModule } from "@/playground/playground.module.js";
import { QueueModule } from "@/queue/queue.module.js";
import { QuotaMetersModule } from "@/quota-meters/quota-meters.module.js";
import { RoutingModule } from "@/routing/routing.module.js";
import { SettingsModule } from "@/settings/settings.module.js";
import { PricingWindowsModule } from "@/pricing-windows/pricing-windows.module.js";
import { TimeZoneModule } from "@/time-zone/time-zone.module.js";
import { UpstreamModule } from "@/upstream/upstream.module.js";
import { UsageModule } from "@/usage/usage.module.js";

type ModuleImport = NonNullable<ModuleMetadata["imports"]>[number];

const SHARED_IMPORTS: ModuleImport[] = [
  ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
  DrizzleModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => ({
      drizzle,
      connection: config.get("DATABASE_URL", { infer: true }),
      relations,
    }),
  }),
  CqrsModule.forRoot(),
  LibsModule,
  AuthModule,
  QueueModule,
  ApiKeysModule,
  IntegrationsModule,
  UpstreamModule,
  PricingWindowsModule,
  RoutingModule,
  UsageModule,
  SettingsModule,
  QuotaMetersModule,
  HealthModule,
];

const DASHBOARD_ONLY_IMPORTS: ModuleImport[] = [
  ControlPlaneModule.overHttp(),
  ErrorCapturesModule,
  OverviewModule,
  TimeZoneModule,
  PlaygroundModule,
  CatalogGapsModule,
];

const ROLE_IMPORTS: Record<BackendRole, ModuleImport[]> = {
  all: [InferenceModule.overHttp(), ...DASHBOARD_ONLY_IMPORTS],
  inference: [InferenceModule.overHttp(), ClosedDashboardApiModule],
  admin: [InferenceModule, ...DASHBOARD_ONLY_IMPORTS],
};

@Module({})
export class AppModule {
  static forRole(role: BackendRole): DynamicModule {
    return {
      module: AppModule,
      imports: [...SHARED_IMPORTS, ...ROLE_IMPORTS[role]],
      controllers: role === "all" ? [AppController] : [],
      providers: [{ provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
    };
  }
}
