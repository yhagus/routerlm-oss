import { Command } from "@nestjs/cqrs";
import type { ErrorCaptureRetention } from "../../models/error-capture-retention.js";

/** Returns the Retention Period to its default. */
export class ResetErrorCaptureRetentionCommand extends Command<ErrorCaptureRetention> {}
