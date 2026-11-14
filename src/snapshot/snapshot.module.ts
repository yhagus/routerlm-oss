import { Module } from "@nestjs/common";
import { SnapshotService } from "./snapshot.service.js";

/**
 * The inference path's in-memory snapshot. Dashboard modules import it to
 * call `SnapshotService.changed()` after their writes.
 */
@Module({
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class SnapshotModule {}
