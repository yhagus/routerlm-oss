import { Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import type { ErrorCaptureDetail, ErrorCapturePage } from "./error-capture.js";
import {
  type ErrorCapturePageQuery,
  errorCapturePageQuerySchema,
} from "./error-captures.schemas.js";
import { ErrorCapturesService } from "./error-captures.service.js";

/** The Error Captures page. Only a User's session gets in: captures hold prompts. */
@DashboardController("error-captures")
export class ErrorCapturesController {
  constructor(private readonly errorCaptures: ErrorCapturesService) {}

  @Get()
  listErrorCaptures(
    @Query({ schema: errorCapturePageQuerySchema }) query: ErrorCapturePageQuery,
  ): Promise<ErrorCapturePage> {
    return this.errorCaptures.listErrorCaptures(query);
  }

  @Get(":id")
  showErrorCapture(@Param("id", ParseUUIDPipe) id: string): Promise<ErrorCaptureDetail> {
    return this.errorCaptures.showErrorCapture(id);
  }
}
