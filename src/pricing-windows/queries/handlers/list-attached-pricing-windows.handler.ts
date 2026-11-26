import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import {
  type AttachedPricingWindow,
  readAttachedPricingWindows,
} from '@/pricing-windows/models/upstream-model-pricing-windows';
import { ListAttachedPricingWindowsQuery } from '@/pricing-windows/queries/impl/list-attached-pricing-windows.query';

@QueryHandler(ListAttachedPricingWindowsQuery)
export class ListAttachedPricingWindowsHandler implements IQueryHandler<ListAttachedPricingWindowsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<Map<string, AttachedPricingWindow[]>> {
    return readAttachedPricingWindows(this.db);
  }
}
