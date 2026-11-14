import { Injectable } from "@nestjs/common";
import { SnapshotService } from "../snapshot/snapshot.service.js";

/**
 * The one place told that Models or Routes changed. Every dashboard write
 * calls `changed()` once it has committed, so the gateway's in-memory
 * snapshot is refreshed (here and, through Redis, on every instance).
 */
@Injectable()
export class RoutingChangeSignal {
  constructor(private readonly snapshot: SnapshotService) {}

  changed(): Promise<void> {
    return this.snapshot.changed();
  }
}
