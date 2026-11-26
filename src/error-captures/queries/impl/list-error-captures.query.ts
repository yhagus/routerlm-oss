import { Query } from "@nestjs/cqrs";
import type { ErrorCapturePage } from "@/error-captures/models/error-capture";
import type { ErrorCapturePageQuery } from "@/error-captures/schemas/error-capture-page-query.schema";

export class ListErrorCapturesQuery extends Query<ErrorCapturePage> {
  constructor(readonly pageQuery: ErrorCapturePageQuery) {
    super();
  }
}
