import { Module } from "@nestjs/common";
import { LocksModule } from "@nestjs/locks";
import { RedisConnection } from "./providers/redis-connection.js";
import { RedisLockStore } from "./providers/redis-lock-store.js";

/**
 * The shared Redis connection for Cooldown state and snapshot change notices,
 * and the locks kept on it. No first-party Nest package covers a plain Redis
 * client, so the connection is a native provider (ADR 0001). The locks are
 * first-party (`@nestjs/locks`, global), with their store registered here.
 * BullMQ keeps its own connections (QueueModule).
 */
@Module({
  imports: [LocksModule.forRoot()],
  providers: [RedisConnection, RedisLockStore],
  exports: [RedisConnection],
})
export class RedisModule {}
