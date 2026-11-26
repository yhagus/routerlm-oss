import { NotFoundException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { errorCaptures } from "@/db/schemas";
import type { ErrorCaptureDetail } from "@/error-captures/models/error-capture";
import { selectSummaryRows, summaryOf } from "@/error-captures/models/error-capture-summaries";
import { ShowErrorCaptureQuery } from "@/error-captures/queries/impl/show-error-capture.query";

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
