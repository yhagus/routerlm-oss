import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpClientModule } from "@nestjs/http-client";
import type { Env } from "@/config/schemas/env.schema.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { ProviderAccountQuotaController } from "./provider-account-quota.controller.js";
import { KimiCodeQuotaReader } from "./providers/kimi-code-quota-reader.js";
import { MiniMaxMPlanQuotaReader } from "./providers/minimax-m-plan-quota-reader.js";
import { QUOTA_READER_HTTP_CLIENT } from "./providers/quota-reader-http-client.js";
import { QuotaReaders } from "./providers/quota-readers.js";
import { QueryHandlers } from "./queries/handlers/index.js";

/**
 * Quota Meters: the quota readers, reading a Provider Account's meters now
 * from the dashboard, and the meters the dashboard lists. The worker imports
 * it too, for the reading schedule. Exhausted state and keys are UpstreamModule's.
 */
@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: QUOTA_READER_HTTP_CLIENT,
      inject: [ConfigService],
      // No retries: the next scheduled reading is the retry. No base URL: each
      // reader takes its Provider's, or the `quotaBaseUrl` quirk. A redirect
      // fails rather than carry the key elsewhere.
      useFactory: (config: ConfigService<Env, true>) => ({
        timeout: config.get("QUOTA_READER_TIMEOUT_MS", { infer: true }),
        retry: false,
        redirect: "error",
      }),
    }),
  ],
  controllers: [ProviderAccountQuotaController],
  providers: [
    MiniMaxMPlanQuotaReader,
    KimiCodeQuotaReader,
    QuotaReaders,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
})
export class QuotaMetersModule {}
