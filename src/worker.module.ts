import { BullModule } from '@nestjs/bullmq';
import { AuthenticationModule } from '@nestjs/authentication';
import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { type Env, envSchema } from '@/config/schemas/env.schema';
import { ControlPlaneModule } from '@/control-plane/control-plane.module';
import { relations } from '@/db/schemas/relations';
import {
  ErrorCaptureRetention,
  ErrorCaptureRetentionProcessor,
} from '@/error-captures/jobs/error-capture-retention';
import { LibsModule } from '@/libs/libs.module';
import { PingProcessor } from '@/queue/jobs/ping.processor';
import { QUEUE_NAMES } from '@/queue/models/queue-names';
import {
  QuotaReadingSchedule,
  QuotaReadingScheduleProcessor,
} from '@/quota-meters/jobs/quota-reading-schedule';
import { QuotaMetersModule } from '@/quota-meters/quota-meters.module';
import { SettingsModule } from '@/settings/settings.module';
import { SpendLimitsModule } from '@/spend-limits/spend-limits.module';
import { OauthSignInPollingProcessor } from '@/upstream/jobs/oauth-sign-in-polling';
import { UpstreamModule } from '@/upstream/upstream.module';
import { UsageWriter } from '@/usage/providers/usage-writer';
import { UsageProcessor } from '@/usage/jobs/usage.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get('DATABASE_URL', { infer: true }),
        relations,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
    CqrsModule.forRoot(),
    LibsModule,
    QuotaMetersModule,
    SettingsModule,
    SpendLimitsModule,
    UpstreamModule,
  ],
  providers: [
    PingProcessor,
    UsageProcessor,
    UsageWriter,
    ErrorCaptureRetention,
    ErrorCaptureRetentionProcessor,
    QuotaReadingSchedule,
    QuotaReadingScheduleProcessor,
    OauthSignInPollingProcessor,
  ],
})
export class WorkerModule {
  static withControlPlane(): DynamicModule {
    return {
      module: WorkerModule,
      imports: [AuthenticationModule.forRoot({}), ControlPlaneModule.overGrpc()],
    };
  }
}
