import {
  type DynamicModule,
  Module,
  type ModuleMetadata,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { APP_PIPE } from '@nestjs/core';
import { ApiKeysModule } from '@/api-keys/api-keys.module';
import { IntegrationsModule } from '@/integrations/integrations.module';
import { AppController } from '@/app.controller';
import { AuthModule } from '@/auth/auth.module';
import { ClosedDashboardApiModule } from '@/backend-roles/closed-dashboard-api.module';
import { ControlPlaneModule } from '@/control-plane/control-plane.module';
import { CatalogGapsModule } from '@/catalog/catalog-gaps.module';
import { type BackendRole, type Env, envSchema } from '@/config/schemas/env.schema';
import { relations } from '@/db/schemas/relations';
import { ErrorCapturesModule } from '@/error-captures/error-captures.module';
import { HealthModule } from '@/health/health.module';
import { LibsModule } from '@/libs/libs.module';
import { InferenceModule } from '@/inference/inference.module';
import { OverviewModule } from '@/overview/overview.module';
import { PlaygroundModule } from '@/playground/playground.module';
import { QueueModule } from '@/queue/queue.module';
import { PlansModule } from '@/plans/plans.module';
import { QuotaMetersModule } from '@/quota-meters/quota-meters.module';
import { RoutingModule } from '@/routing/routing.module';
import { SettingsModule } from '@/settings/settings.module';
import { PricingWindowsModule } from '@/pricing-windows/pricing-windows.module';
import { TimeZoneModule } from '@/time-zone/time-zone.module';
import { UpstreamModule } from '@/upstream/upstream.module';
import { UsageModule } from '@/usage/usage.module';

type ModuleImport = NonNullable<ModuleMetadata['imports']>[number];

const SHARED_IMPORTS: ModuleImport[] = [
  ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
  DrizzleModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => ({
      drizzle,
      connection: config.get('DATABASE_URL', { infer: true }),
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
  PlansModule,
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
      controllers: role === 'all' ? [AppController] : [],
      providers: [{ provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
    };
  }
}
