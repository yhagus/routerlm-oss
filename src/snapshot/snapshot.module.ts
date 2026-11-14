import { Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module.js";
import { SnapshotService } from "./snapshot.service.js";

/**
 * The inference path's in-memory snapshot. Dashboard modules import it to
 * call `SnapshotService.changed()` after their writes.
 */
@Module({
  imports: [RedisModule],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class SnapshotModule {}
