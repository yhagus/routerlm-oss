import { Query } from "@nestjs/cqrs";
import type { ErrorCaptureRetention } from "@/settings/models/error-capture-retention.js";

export class ShowErrorCaptureRetentionQuery extends Query<ErrorCaptureRetention> {}
