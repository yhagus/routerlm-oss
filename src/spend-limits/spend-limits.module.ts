import { Module } from "@nestjs/common";
import { RedisModule } from "@/redis/redis.module";
import { SpendLimitFlags } from "./providers/spend-limit-flags";

@Module({
  imports: [RedisModule],
  providers: [SpendLimitFlags],
  exports: [SpendLimitFlags],
})
export class SpendLimitsModule {}
