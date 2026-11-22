import { Query } from "@nestjs/cqrs";
import type { ErrorCapturePage } from "@/error-captures/models/error-capture.js";
import type { ErrorCapturePageQuery } from "@/error-captures/schemas/error-capture-page-query.schema.js";

/** One page of Error Captures, newest first. */
export class ListErrorCapturesQuery extends Query<ErrorCapturePage> {
  constructor(readonly pageQuery: ErrorCapturePageQuery) {
    super();
  }
}
