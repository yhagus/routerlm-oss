import { Module } from "@nestjs/common";
import { RedisConnection } from "./redis-connection.js";

/**
 * The shared Redis connection for Cooldown state and snapshot change notices.
 * No first-party Nest package covers a plain Redis client, so it is a native
 * provider (ADR 0001). BullMQ keeps its own connections (QueueModule).
 */
@Module({
  providers: [RedisConnection],
  exports: [RedisConnection],
})
export class RedisModule {}
