import { Query } from "@nestjs/cqrs";
import type { ErrorCaptureDetail } from "@/error-captures/models/error-capture.js";

/** One Error Capture whole, headers and bodies included. */
export class ShowErrorCaptureQuery extends Query<ErrorCaptureDetail> {
  constructor(readonly id: string) {
    super();
  }
}
