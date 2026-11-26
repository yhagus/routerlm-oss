import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientModule } from '@nestjs/http-client';
import type { Env } from '@/config/schemas/env.schema';
import { OutboundFetch } from '@/libs/providers/outbound-fetch';
import { CommandHandlers } from './commands/handlers';
import { ProviderAccountQuotaController } from './provider-account-quota.controller';
import { KimiCodeQuotaReader } from './providers/kimi-code-quota-reader';
import { MiniMaxMPlanQuotaReader } from './providers/minimax-m-plan-quota-reader';
import { OpenAiCodexQuotaReader } from './providers/openai-codex-quota-reader';
import { OpenAiCodexUsageResets } from './providers/openai-codex-usage-resets';
import { QUOTA_READER_HTTP_CLIENT } from './providers/quota-reader-http-client';
import { QuotaReaders } from './providers/quota-readers';
import { UsageResetTargets } from './providers/usage-reset-targets';
import { QueryHandlers } from './queries/handlers';
import { UpstreamModule } from '@/upstream/upstream.module';

@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: QUOTA_READER_HTTP_CLIENT,
      inject: [ConfigService, OutboundFetch],
      useFactory: (config: ConfigService<Env, true>, outbound: OutboundFetch) => ({
        timeout: config.get('QUOTA_READER_TIMEOUT_MS', { infer: true }),
        retry: false,
        redirect: 'error',
        fetch: outbound.fetch,
      }),
    }),
    UpstreamModule,
  ],
  controllers: [ProviderAccountQuotaController],
  providers: [
    MiniMaxMPlanQuotaReader,
    KimiCodeQuotaReader,
    OpenAiCodexQuotaReader,
    OpenAiCodexUsageResets,
    QuotaReaders,
    UsageResetTargets,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
})
export class QuotaMetersModule {}
