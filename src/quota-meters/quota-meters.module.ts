import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpClientModule } from "@nestjs/http-client";
import type { Env } from "@/config/schemas/env.schema.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { ProviderAccountQuotaController } from "./provider-account-quota.controller.js";
import {
  MINIMAX_M_PLAN_QUOTA_CLIENT,
  MiniMaxMPlanQuotaReader,
} from "./providers/minimax-m-plan-quota-reader.js";
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
      name: MINIMAX_M_PLAN_QUOTA_CLIENT,
      inject: [ConfigService],
      // No retries: the next scheduled reading is the retry.
      useFactory: (config: ConfigService<Env, true>) => ({
        baseUrl: config.get("MINIMAX_M_PLAN_QUOTA_BASE_URL", { infer: true }),
        timeout: config.get("QUOTA_READER_TIMEOUT_MS", { infer: true }),
        retry: false,
      }),
    }),
  ],
  controllers: [ProviderAccountQuotaController],
  providers: [MiniMaxMPlanQuotaReader, QuotaReaders, ...CommandHandlers, ...QueryHandlers],
})
export class QuotaMetersModule {}
