import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpClientModule } from "@nestjs/http-client";
import type { Env } from "@/config/schemas/env.schema.js";
import { OutboundFetch } from "@/libs/providers/outbound-fetch.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { ProviderAccountQuotaController } from "./provider-account-quota.controller.js";
import { KimiCodeQuotaReader } from "./providers/kimi-code-quota-reader.js";
import { MiniMaxMPlanQuotaReader } from "./providers/minimax-m-plan-quota-reader.js";
import { OpenAiCodexQuotaReader } from "./providers/openai-codex-quota-reader.js";
import { OpenAiCodexUsageResets } from "./providers/openai-codex-usage-resets.js";
import { QUOTA_READER_HTTP_CLIENT } from "./providers/quota-reader-http-client.js";
import { QuotaReaders } from "./providers/quota-readers.js";
import { UsageResetTargets } from "./providers/usage-reset-targets.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { UpstreamModule } from "@/upstream/upstream.module.js";

@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: QUOTA_READER_HTTP_CLIENT,
      inject: [ConfigService, OutboundFetch],
      useFactory: (config: ConfigService<Env, true>, outbound: OutboundFetch) => ({
        timeout: config.get("QUOTA_READER_TIMEOUT_MS", { infer: true }),
        retry: false,
        redirect: "error",
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
