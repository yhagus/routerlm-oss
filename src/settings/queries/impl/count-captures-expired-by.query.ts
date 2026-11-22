import { Query } from "@nestjs/cqrs";
import type { ErrorCaptureRetentionImpact } from "@/settings/models/error-capture-retention.js";

/** How many Error Captures a Retention Period of `days` would delete right now. */
export class CountCapturesExpiredByQuery extends Query<ErrorCaptureRetentionImpact> {
  constructor(readonly days: number) {
    super();
  }
}
