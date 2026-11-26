import { Module } from '@nestjs/common';
import { LocksModule } from '@nestjs/locks';
import { RedisConnection } from './providers/redis-connection';
import { RedisLockStore } from './providers/redis-lock-store';

@Module({
  imports: [LocksModule.forRoot()],
  providers: [RedisConnection, RedisLockStore],
  exports: [RedisConnection],
})
export class RedisModule {}
