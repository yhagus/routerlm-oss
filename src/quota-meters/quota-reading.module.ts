import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpClientModule } from "@nestjs/http-client";
import type { Env } from "@/config/schemas/env.schema.js";
import { providerKeyCipherProvider } from "@/upstream/providers/provider-key-cipher.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import {
  MINIMAX_M_PLAN_QUOTA_CLIENT,
  MiniMaxMPlanQuotaReader,
} from "./providers/minimax-m-plan-quota-reader.js";
import { QuotaReaders } from "./providers/quota-readers.js";

/**
 * The quota readers and ReadProviderAccountQuotaCommand, shared by the
 * backend (QuotaMetersModule) and the worker. It imports no UpstreamModule,
 * so the worker doesn't load the inference snapshot.
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
  providers: [providerKeyCipherProvider, MiniMaxMPlanQuotaReader, QuotaReaders, ...CommandHandlers],
})
export class QuotaReadingModule {}
