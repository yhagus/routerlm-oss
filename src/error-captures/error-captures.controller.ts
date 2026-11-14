import { Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import type { ErrorCaptureDetail, ErrorCapturePage } from "./models/error-capture.js";
import { ListErrorCapturesQuery } from "./queries/impl/list-error-captures.query.js";
import { ShowErrorCaptureQuery } from "./queries/impl/show-error-capture.query.js";
import {
  type ErrorCapturePageQuery,
  errorCapturePageQuerySchema,
} from "./schemas/error-capture-page-query.schema.js";

/** The Error Captures page. Only a User's session gets in: captures hold prompts. */
@DashboardController("error-captures")
export class ErrorCapturesController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  listErrorCaptures(
    @Query({ schema: errorCapturePageQuerySchema })
    query: ErrorCapturePageQuery,
  ): Promise<ErrorCapturePage> {
    return this.queryBus.execute(new ListErrorCapturesQuery(query));
  }

  @Get(":id")
  showErrorCapture(@Param("id", ParseUUIDPipe) id: string): Promise<ErrorCaptureDetail> {
    return this.queryBus.execute(new ShowErrorCaptureQuery(id));
  }
}
