import type { Snapshot } from "@/snapshot/models/snapshot.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { type PlaygroundSummary, playgroundSummaryOf } from "./playground-summary.js";

/**
 * Keeps the usage job a Playground media request reports through its
 * `onUsage` callback, to summarize once the request has answered.
 */
export class PlaygroundUsage {
  private reportedJob: UsageJob | undefined;

  readonly record = (job: UsageJob): void => {
    this.reportedJob = job;
  };

  /** The reported job; a request reports it however it ends. */
  get job(): UsageJob {
    if (!this.reportedJob) {
      throw new Error("An answered request always reports its usage");
    }
    return this.reportedJob;
  }

  summaryAt(snapshot: Snapshot): PlaygroundSummary {
    return playgroundSummaryOf(this.job, snapshot);
  }
}
