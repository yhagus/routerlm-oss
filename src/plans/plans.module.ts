import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientModule } from '@nestjs/http-client';
import type { Env } from '@/config/schemas/env.schema';
import { OutboundFetch } from '@/libs/providers/outbound-fetch';
import { SnapshotModule } from '@/snapshot/snapshot.module';
import { UpstreamModule } from '@/upstream/upstream.module';
import { CommandHandlers } from './commands/handlers';
import { EventHandlers } from './events/handlers';
import { ProviderAccountPlanController } from './provider-account-plan.controller';
import { PLAN_READER_HTTP_CLIENT } from './providers/plan-reader-http-client';
import { PlanReaders } from './providers/plan-readers';
import { TokenHarborPlanReader } from './providers/tokenharbor-plan-reader';

@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: PLAN_READER_HTTP_CLIENT,
      inject: [ConfigService, OutboundFetch],
      useFactory: (config: ConfigService<Env, true>, outbound: OutboundFetch) => ({
        timeout: config.get('QUOTA_READER_TIMEOUT_MS', { infer: true }),
        retry: false,
        redirect: 'error',
        fetch: outbound.fetch,
      }),
    }),
    SnapshotModule,
    UpstreamModule,
  ],
  controllers: [ProviderAccountPlanController],
  providers: [TokenHarborPlanReader, PlanReaders, ...CommandHandlers, ...EventHandlers],
})
export class PlansModule {}
