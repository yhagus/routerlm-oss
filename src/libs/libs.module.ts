import { Global, Module } from "@nestjs/common";
import { minutes, ThrottlerModule } from "@nestjs/throttler";
import { RedisConnection } from "@/redis/providers/redis-connection.js";
import { RedisModule } from "@/redis/redis.module.js";
import { OutboundFetch } from "./providers/outbound-fetch.js";
import { RedisThrottlerStorage } from "./providers/redis-throttler-storage.js";

const LOGINS_PER_MINUTE = 10;

@Global()
@Module({
  imports: [
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisConnection],
      useFactory: (redis: RedisConnection) => ({
        throttlers: [{ ttl: minutes(1), limit: LOGINS_PER_MINUTE }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  providers: [OutboundFetch],
  exports: [ThrottlerModule, OutboundFetch],
})
export class LibsModule {}
