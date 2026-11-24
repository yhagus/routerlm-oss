import { Command } from "@nestjs/cqrs";
import type { ErrorCaptureRetention } from "@/settings/models/error-capture-retention.js";

export class ChangeErrorCaptureRetentionCommand extends Command<ErrorCaptureRetention> {
  constructor(readonly days: number) {
    super();
  }
}
