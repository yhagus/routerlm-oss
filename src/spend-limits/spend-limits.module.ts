import { Module } from "@nestjs/common";
import { RedisModule } from "@/redis/redis.module.js";
import { SpendLimitFlags } from "./providers/spend-limit-flags.js";

/**
 * Whether each API Key has reached its Spend Limit (ADR 0035): counted in
 * Postgres with the Usage Log, flagged in Redis for the inference path.
 * No first-party Nest package covers it, so it is a native provider (ADR 0001).
 */
@Module({
  imports: [RedisModule],
  providers: [SpendLimitFlags],
  exports: [SpendLimitFlags],
})
export class SpendLimitsModule {}
