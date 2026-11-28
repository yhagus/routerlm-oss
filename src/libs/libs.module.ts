import { Global, Module } from '@nestjs/common';
import { minutes, ThrottlerModule } from '@nestjs/throttler';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { RedisModule } from '@/redis/redis.module';
import { BackgroundWork } from './providers/background-work';
import { OutboundFetch } from './providers/outbound-fetch';
import { RedisThrottlerStorage } from './providers/redis-throttler-storage';

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
  providers: [BackgroundWork, OutboundFetch],
  exports: [BackgroundWork, ThrottlerModule, OutboundFetch],
})
export class LibsModule {}
