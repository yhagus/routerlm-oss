import { Injectable } from "@nestjs/common";

/**
 * The one place told that Providers, Upstream Models or Provider Accounts
 * changed. Every dashboard write calls `changed()` once it has committed, so
 * the gateway's in-memory snapshot can be refreshed from here.
 */
@Injectable()
export class UpstreamChangeSignal {
  changed(): Promise<void> {
    // Nothing reads the snapshot yet; its "snapshot changed" Redis signal is published here.
    return Promise.resolve();
  }
}
