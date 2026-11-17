import { Command } from "@nestjs/cqrs";
import type { ErrorCaptureRetention } from "../../models/error-capture-retention.js";

/** Saves a new Retention Period. The worker deletes by it from its next run. */
export class ChangeErrorCaptureRetentionCommand extends Command<ErrorCaptureRetention> {
  constructor(readonly days: number) {
    super();
  }
}
