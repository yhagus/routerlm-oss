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
import { QUOTA_READER_HTTP_CLIENT } from "./providers/quota-reader-http-client.js";
import { QuotaReaders } from "./providers/quota-readers.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { UpstreamModule } from "@/upstream/upstream.module.js";

/**
 * Quota Meters: the quota readers, reading a Provider Account's meters now
 * from the dashboard, and the meters the dashboard lists. The worker imports
 * it too, for the reading schedule. Exhausted state and credentials are UpstreamModule's.
 */
@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: QUOTA_READER_HTTP_CLIENT,
      inject: [ConfigService, OutboundFetch],
      // No retries: the next scheduled reading is the retry. No base URL: each
      // reader takes its Provider's, or the `quotaBaseUrl` quirk. A redirect
      // fails rather than carry the key elsewhere.
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
    QuotaReaders,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
})
export class QuotaMetersModule {}
