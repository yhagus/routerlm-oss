import { Module } from "@nestjs/common";
import { RedisModule } from "@/redis/redis.module.js";
import { SpendLimitFlags } from "./providers/spend-limit-flags.js";

@Module({
  imports: [RedisModule],
  providers: [SpendLimitFlags],
  exports: [SpendLimitFlags],
})
export class SpendLimitsModule {}
