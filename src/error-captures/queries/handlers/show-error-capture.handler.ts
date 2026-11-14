import { NotFoundException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "../../../db/relations.js";
import { errorCaptures } from "../../../db/schema.js";
import type { ErrorCaptureDetail } from "../../models/error-capture.js";
import { selectSummaryRows, summaryOf } from "../../models/error-capture-summaries.js";
import { ShowErrorCaptureQuery } from "../impl/show-error-capture.query.js";

@QueryHandler(ShowErrorCaptureQuery)
export class ShowErrorCaptureHandler implements IQueryHandler<ShowErrorCaptureQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ id }: ShowErrorCaptureQuery): Promise<ErrorCaptureDetail> {
    const [[summary], [content]] = await Promise.all([
      selectSummaryRows(this.db).where(eq(errorCaptures.id, id)),
      this.db
        .select({
          requestHeaders: errorCaptures.requestHeaders,
          requestBody: errorCaptures.requestBody,
          responseHeaders: errorCaptures.responseHeaders,
          responseBody: errorCaptures.responseBody,
        })
        .from(errorCaptures)
        .where(eq(errorCaptures.id, id)),
    ]);
    if (!summary || !content) {
      throw new NotFoundException("Error Capture not found");
    }
    return { ...summaryOf(summary), ...content };
  }
}
