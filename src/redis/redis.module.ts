import { Module } from "@nestjs/common";
import { LocksModule } from "@nestjs/locks";
import { RedisConnection } from "./providers/redis-connection.js";
import { RedisLockStore } from "./providers/redis-lock-store.js";

@Module({
  imports: [LocksModule.forRoot()],
  providers: [RedisConnection, RedisLockStore],
  exports: [RedisConnection],
})
export class RedisModule {}
