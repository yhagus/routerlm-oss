import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { count, lt } from "drizzle-orm";
import { errorCaptures } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { retentionCutoff } from "@/error-captures/models/retention-cutoff.js";
import type { ErrorCaptureRetentionImpact } from "@/settings/models/error-capture-retention.js";
import { CountCapturesExpiredByQuery } from "@/settings/queries/impl/count-captures-expired-by.query.js";

@QueryHandler(CountCapturesExpiredByQuery)
export class CountCapturesExpiredByHandler implements IQueryHandler<CountCapturesExpiredByQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ days }: CountCapturesExpiredByQuery): Promise<ErrorCaptureRetentionImpact> {
    const [{ deleteCount }] = await this.db
      .select({ deleteCount: count() })
      .from(errorCaptures)
      .where(lt(errorCaptures.createdAt, retentionCutoff(new Date(), days)));
    return { deleteCount };
  }
}
