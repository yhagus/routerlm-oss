import { NotFoundException } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { upstreamModels } from '@/db/schemas';
import {
  type AttachedPricingWindow,
  readPricingWindowsOf,
} from '@/pricing-windows/models/upstream-model-pricing-windows';
import { ListUpstreamModelPricingWindowsQuery } from '@/pricing-windows/queries/impl/list-upstream-model-pricing-windows.query';

@QueryHandler(ListUpstreamModelPricingWindowsQuery)
export class ListUpstreamModelPricingWindowsHandler implements IQueryHandler<ListUpstreamModelPricingWindowsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({
    upstreamModelId,
  }: ListUpstreamModelPricingWindowsQuery): Promise<AttachedPricingWindow[]> {
    const [upstreamModel] = await this.db
      .select({ id: upstreamModels.id })
      .from(upstreamModels)
      .where(eq(upstreamModels.id, upstreamModelId));
    if (!upstreamModel) {
      throw new NotFoundException('Upstream Model not found');
    }
    return readPricingWindowsOf(this.db, upstreamModelId);
  }
}
