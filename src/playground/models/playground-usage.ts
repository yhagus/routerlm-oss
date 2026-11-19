import type { Snapshot } from "@/snapshot/models/snapshot.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { type PlaygroundSummary, playgroundSummaryOf } from "./playground-summary.js";

/**
 * Keeps the usage job a Playground media request reports through its
 * `onUsage` callback, to summarize once the request has answered.
 */
export class PlaygroundUsage {
  private job: UsageJob | undefined;

  readonly record = (job: UsageJob): void => {
    this.job = job;
  };

  summaryAt(snapshot: Snapshot): PlaygroundSummary {
    if (!this.job) {
      throw new Error("An answered request always reports its usage");
    }
    return playgroundSummaryOf(this.job, snapshot);
  }
}
