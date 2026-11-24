import { Command } from "@nestjs/cqrs";
import type { ErrorCaptureRetention } from "@/settings/models/error-capture-retention.js";

export class ResetErrorCaptureRetentionCommand extends Command<ErrorCaptureRetention> {}
