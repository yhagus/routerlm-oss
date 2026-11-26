import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { count, lt } from 'drizzle-orm';
import { errorCaptures } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import { retentionCutoff } from '@/error-captures/models/retention-cutoff';
import type { ErrorCaptureRetentionImpact } from '@/settings/models/error-capture-retention';
import { CountCapturesExpiredByQuery } from '@/settings/queries/impl/count-captures-expired-by.query';

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
