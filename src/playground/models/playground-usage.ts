import type { Snapshot } from "@/snapshot/models/snapshot";
import type { UsageJob } from "@/usage/models/usage-job";
import { type PlaygroundSummary, playgroundSummaryOf } from "./playground-summary";

export class PlaygroundUsage {
  private reportedJob: UsageJob | undefined;

  readonly record = (job: UsageJob): void => {
    this.reportedJob = job;
  };

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
