import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule } from "@/redis/redis.module.js";
import { SnapshotService } from "./providers/snapshot.service.js";

/**
 * The inference path's in-memory snapshot. Dashboard modules import it to
 * call `SnapshotService.changed()` after their writes.
 */
@Module({
  imports: [RedisModule, ScheduleModule.forRoot()],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class SnapshotModule {}
