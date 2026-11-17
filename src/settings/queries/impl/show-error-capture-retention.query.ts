import { Query } from "@nestjs/cqrs";
import type { ErrorCaptureRetention } from "../../models/error-capture-retention.js";

/** The current Retention Period, read from the database on every call. */
export class ShowErrorCaptureRetentionQuery extends Query<ErrorCaptureRetention> {}
